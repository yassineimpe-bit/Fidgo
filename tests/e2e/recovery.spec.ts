import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { createMerchant, currentCustomerId, enrollCustomer, origin, unique } from "./helpers";

function recoveryToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

async function cardRecord(sql: ReturnType<typeof postgres>, cardToken: string) {
  const [card] = await sql`
    select c.id, c.establishment_id, c.customer_id, e.slug
    from cards c
    join establishments e on e.id=c.establishment_id
    where c.token=${cardToken}
  `;
  expect(card).toBeTruthy();
  return card;
}

/**
 * /api/recovery/request ne doit jamais laisser deviner si une adresse est
 * associée à une carte : même statut, même corps de réponse, qu'une carte
 * existe ou non.
 */
test("récupération de carte : réponse identique qu'une carte existe ou non", async ({ page }) => {
  await createMerchant(page, "recovery");
  const slugCode = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  const slug = slugCode?.replace("/j/", "").trim();
  expect(slug).toBeTruthy();

  const realEmail = `${unique("client")}@example.com`;
  await enrollCustomer(page, "Alix", realEmail);

  const withCard = await page.request.post("/api/recovery/request", {
    headers: { origin },
    data: { slug, email: realEmail },
  });
  const withoutCard = await page.request.post("/api/recovery/request", {
    headers: { origin },
    data: { slug, email: `${unique("nobody")}@example.com` },
  });

  expect(withCard.status()).toBe(withoutCard.status());
  expect(await withCard.json()).toEqual(await withoutCard.json());
  expect(withCard.headers()["cache-control"]).toContain("no-store");
});

test("page de récupération : le secret URL n'est ni caché, ni référencé, ni indexé", async ({ page }) => {
  const token = "a".repeat(43);
  const response = await page.goto(`/recover/${token}`);

  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
});

test("rectifier l'e-mail révoque le lien actif sans exposer le token carte", async ({ page }) => {
  await createMerchant(page, "recovery-email-change");
  const oldEmail = `${unique("old-recovery")}@example.com`;
  const newEmail = `${unique("new-recovery")}@example.com`;
  const { cardUrl } = await enrollCustomer(page, "Mina", oldEmail);
  const cardToken = new URL(cardUrl).pathname.split("/").at(-1)!;
  const customerId = await currentCustomerId(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

  try {
    const card = await cardRecord(sql, cardToken);
    const link = recoveryToken();
    await sql`
      insert into card_recovery_tokens(establishment_id,card_id,token_hash,expires_at)
      values(${card.establishment_id},${card.id},${link.hash},now()+interval '15 minutes')
    `;

    const updated = await page.request.patch(`/api/customers/${customerId}`, {
      headers: { origin },
      data: { email: newEmail },
    });
    expect(updated.status()).toBe(200);

    const [state] = await sql`
      select
        u.email,
        r.used_at,
        coalesce((select string_agg(metadata::text,' ') from audit_logs
          where action='CUSTOMER_CONTACT_UPDATED' and entity_id=${customerId}),'') as audit_metadata
      from customers u
      join cards c on c.customer_id=u.id
      join card_recovery_tokens r on r.card_id=c.id and r.token_hash=${link.hash}
      where u.id=${customerId}
    `;
    expect(state.email).toBe(newEmail);
    expect(state.used_at).toBeTruthy();
    expect(String(state.audit_metadata)).not.toContain(oldEmail);
    expect(String(state.audit_metadata)).not.toContain(newEmail);

    const consumed = await page.request.post("/api/recovery/consume", {
      headers: { origin },
      data: { token: link.token },
    });
    expect(consumed.status()).toBe(400);
    expect(JSON.stringify(await consumed.json())).not.toContain(cardToken);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("un envoi vers l'ancien e-mail ne s'active pas après rectification concurrente", async ({ page }) => {
  await createMerchant(page, "recovery-request-email-race");
  const oldEmail = `${unique("race-old")}@example.com`;
  const newEmail = `${unique("race-new")}@example.com`;
  const { cardUrl } = await enrollCustomer(page, "Noa", oldEmail);
  const cardToken = new URL(cardUrl).pathname.split("/").at(-1)!;
  const customerId = await currentCustomerId(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 3, prepare: false });
  const blocker = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const card = await cardRecord(sql, cardToken);
  let locked = false;

  try {
    await blocker`select pg_advisory_lock(hashtextextended(${String(card.id)},149))`;
    locked = true;

    const requested = await page.request.post("/api/recovery/request", {
      headers: { origin },
      data: { slug: card.slug, email: oldEmail },
    });
    expect(requested.status()).toBe(202);

    await expect.poll(async () => {
      const [row] = await sql`
        select count(*)::int as count from card_recovery_tokens where card_id=${card.id}
      `;
      return Number(row.count);
    }).toBeGreaterThan(0);

    const updated = await page.request.patch(`/api/customers/${customerId}`, {
      headers: { origin },
      data: { email: newEmail },
    });
    expect(updated.status()).toBe(200);

    await blocker`select pg_advisory_unlock(hashtextextended(${String(card.id)},149))`;
    locked = false;

    await expect.poll(async () => {
      const [row] = await sql`
        select count(*)::int as count from audit_logs
        where action='CARD_RECOVERY_EMAIL_SENT'
          and entity_id=${String(card.id)}
          and metadata->>'activated'='false'
      `;
      return Number(row.count);
    }).toBe(1);

    const [state] = await sql`
      select
        (select email from customers where id=${customerId}) as email,
        count(*) filter (where used_at is null)::int as active_tokens
      from card_recovery_tokens where card_id=${card.id}
    `;
    expect(state.email).toBe(newEmail);
    expect(Number(state.active_tokens)).toBe(0);
  } finally {
    if (locked) await blocker`select pg_advisory_unlock(hashtextextended(${String(card.id)},149))`;
    await blocker.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  }
});

test("deux demandes concurrentes laissent au plus un lien actif en base", async ({ page }) => {
  await createMerchant(page, "recovery-request-race");
  const email = `${unique("request-race")}@example.com`;
  const { cardUrl } = await enrollCustomer(page, "Lina", email);
  const cardToken = new URL(cardUrl).pathname.split("/").at(-1)!;
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });
  const blocker = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const card = await cardRecord(sql, cardToken);
  let locked = false;

  try {
    await blocker`select pg_advisory_lock(hashtextextended(${String(card.id)},149))`;
    locked = true;

    const responses = await Promise.all([
      page.request.post("/api/recovery/request", { headers: { origin }, data: { slug: card.slug, email } }),
      page.request.post("/api/recovery/request", { headers: { origin }, data: { slug: card.slug, email } }),
    ]);
    expect(responses.map((response) => response.status())).toEqual([202, 202]);

    await expect.poll(async () => {
      const [row] = await sql`
        select count(*)::int as count from card_recovery_tokens where card_id=${card.id}
      `;
      return Number(row.count);
    }).toBe(2);

    await blocker`select pg_advisory_unlock(hashtextextended(${String(card.id)},149))`;
    locked = false;

    await expect.poll(async () => {
      const [row] = await sql`
        select count(*)::int as count from audit_logs
        where action='CARD_RECOVERY_EMAIL_SENT'
          and entity_id=${String(card.id)}
          and metadata->>'activated'='true'
      `;
      return Number(row.count);
    }).toBe(2);

    const [state] = await sql`
      select
        count(*)::int as tokens,
        count(*) filter (where used_at is null)::int as active_tokens
      from card_recovery_tokens where card_id=${card.id}
    `;
    expect(Number(state.tokens)).toBe(2);
    expect(Number(state.active_tokens)).toBe(1);

    await expect(sql`
      insert into card_recovery_tokens(establishment_id,card_id,token_hash,expires_at)
      values(${card.establishment_id},${card.id},${recoveryToken().hash},now()+interval '15 minutes')
    `).rejects.toMatchObject({ code: "23505" });
  } finally {
    if (locked) await blocker`select pg_advisory_unlock(hashtextextended(${String(card.id)},149))`;
    await blocker.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  }
});

test("lien de récupération : une seule consommation réussit sous concurrence", async ({ page }) => {
  await createMerchant(page, "recovery-once");
  const email = `${unique("recover-once")}@example.com`;
  const { cardUrl } = await enrollCustomer(page, "Lou", email);
  const cardToken = new URL(cardUrl).pathname.split("/").at(-1)!;
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

  try {
    const [card] = await sql`
      select id, establishment_id
      from cards
      where token = ${cardToken}
    `;
    expect(card).toBeTruthy();

    const link = recoveryToken();
    await sql`
      insert into card_recovery_tokens(establishment_id, card_id, token_hash, expires_at)
      values(${card.establishment_id}, ${card.id}, ${link.hash}, now() + interval '15 minutes')
    `;

    const [first, second] = await Promise.all([
      page.request.post("/api/recovery/consume", {
        headers: { origin },
        data: { token: link.token },
      }),
      page.request.post("/api/recovery/consume", {
        headers: { origin },
        data: { token: link.token },
      }),
    ]);

    expect([first.status(), second.status()].sort()).toEqual([200, 400]);
    const winner = first.status() === 200 ? first : second;
    await expect(winner.json()).resolves.toMatchObject({ token: cardToken });

    const [state] = await sql`
      select
        (select used_at is not null from card_recovery_tokens where token_hash = ${link.hash}) as consumed,
        (select count(*)::int from audit_logs where action = 'CARD_RECOVERY_CONSUMED' and entity_id = ${String(card.id)}) as audit_count
    `;
    expect(state.consumed).toBe(true);
    expect(Number(state.audit_count)).toBe(1);

    const replay = await page.request.post("/api/recovery/consume", {
      headers: { origin },
      data: { token: link.token },
    });
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toEqual({ error: "INVALID_OR_EXPIRED_LINK" });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

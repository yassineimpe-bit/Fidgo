import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

function recoveryToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
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

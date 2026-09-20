import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, currentCustomerId, enrollCustomer, origin, unique } from "./helpers";

function recoveryToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

test("cycle de vie client : export sans secrets puis effacement atomique et ledger conservé", async ({ page }) => {
  await createMerchant(page, "lifecycle-customer");
  const email = `${unique("lifecycle")}@example.com`;
  const { cardUrl } = await enrollCustomer(page, "Ana", email);
  const oldCardToken = cardUrl.split("/c/")[1];
  const customerId = await currentCustomerId(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 3, prepare: false });

  try {
    const [card] = await sql`
      select id,establishment_id from cards where customer_id=${customerId}
    `;
    const link = recoveryToken();
    const pushToken = `push-${randomBytes(16).toString("hex")}`;
    await sql`
      insert into wallet_passes(establishment_id,card_id,provider,external_id,serial_number,authentication_token_hash,status)
      values(${card.establishment_id},${card.id},'APPLE','pass.test.retiko',${String(card.id)},${"a".repeat(64)},'active')
    `;
    const [applePass] = await sql`select id from wallet_passes where card_id=${card.id} and provider='APPLE'`;
    await sql`
      insert into apple_wallet_registrations(wallet_pass_id,device_library_identifier,push_token)
      values(${applePass.id},${`device-${randomBytes(8).toString("hex")}`},${pushToken})
    `;
    await sql`
      insert into wallet_passes(establishment_id,card_id,provider,external_id,status)
      values(${card.establishment_id},${card.id},'GOOGLE',${`object-${card.id}`},'active')
    `;
    await sql`
      insert into card_recovery_tokens(establishment_id,card_id,token_hash,expires_at)
      values(${card.establishment_id},${card.id},${link.hash},now()+interval '15 minutes')
    `;
    await sql`
      insert into push_subscriptions(establishment_id,customer_id,endpoint,p256dh,auth)
      values(${card.establishment_id},${customerId},${`https://push.example/${randomBytes(8).toString("hex")}`},'p256dh-secret','auth-secret')
    `;

    const adjusted = await page.request.post(`/api/customers/${customerId}/adjust`, {
      headers: { origin },
      data: {
        newBalance: 10,
        reason: `demande ${email} LOY1:${oldCardToken}`,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(adjusted.ok()).toBeTruthy();

    const exported = await page.request.get(`/api/customers/${customerId}/export`);
    expect(exported.ok()).toBeTruthy();
    expect(exported.headers()["cache-control"]).toContain("no-store");
    const exportText = await exported.text();
    const exportJson = JSON.parse(exportText);
    expect(exportJson).toMatchObject({ format: "retiko-customer-export", version: 1 });
    expect(exportJson.customer.email).toBe(email);
    expect(exportJson.transactions.length).toBeGreaterThan(0);
    expect(exportJson.walletPasses).toHaveLength(2);
    expect(exportJson.recoveryRequests).toHaveLength(1);
    expect(exportText).not.toContain(oldCardToken);
    expect(exportText).not.toContain(link.hash);
    expect(exportText).not.toContain(pushToken);
    expect(exportText).not.toContain("authentication_token_hash");

    const [deleted, credited, redeemed] = await Promise.all([
      page.request.delete(`/api/customers/${customerId}`, { headers: { origin } }),
      page.request.post("/api/credit", {
        headers: { origin },
        data: { token: `LOY1:${oldCardToken}`, idempotencyKey: crypto.randomUUID() },
      }),
      page.request.post("/api/redeem", {
        headers: { origin },
        data: { token: `LOY1:${oldCardToken}`, idempotencyKey: crypto.randomUUID() },
      }),
    ]);
    expect(deleted.status()).toBe(200);
    expect([200, 404, 409]).toContain(credited.status());
    expect([200, 404, 409]).toContain(redeemed.status());

    const [state] = await sql`
      select
        u.email,u.phone,u.first_name,u.marketing_consent,u.marketing_consent_at,u.deleted_at,
        c.active,c.token,c.short_code,c.balance,
        (select coalesce(sum(delta),0)::int from transactions where card_id=c.id) as ledger_balance,
        (select count(*)::int from transactions where card_id=c.id) as transaction_count,
        (select count(*)::int from wallet_passes where card_id=c.id and status='revoked') as revoked_wallets,
        (select count(*)::int from apple_wallet_registrations r join wallet_passes wp on wp.id=r.wallet_pass_id where wp.card_id=c.id) as apple_registrations,
        (select count(*)::int from card_recovery_tokens where card_id=c.id and used_at is null) as active_recovery,
        (select count(*)::int from push_subscriptions where customer_id=u.id) as push_subscriptions,
        (select count(*)::int from product_events where card_id=c.id) as linked_events
      from customers u join cards c on c.customer_id=u.id where u.id=${customerId}
    `;
    expect(state.email).toBeNull();
    expect(state.phone).toBeNull();
    expect(state.first_name).toBeNull();
    expect(state.marketing_consent).toBe(false);
    expect(state.marketing_consent_at).toBeNull();
    expect(state.deleted_at).toBeTruthy();
    expect(state.active).toBe(false);
    expect(String(state.token)).toMatch(/^ERASED_[a-f0-9]{64}$/);
    expect(state.token).not.toBe(oldCardToken);
    expect(Number(state.balance)).toBe(Number(state.ledger_balance));
    expect(Number(state.transaction_count)).toBeGreaterThan(0);
    expect(Number(state.revoked_wallets)).toBe(2);
    // Conservé temporairement afin que l'appareil puisse demander le pass
    // Apple `voided`; la purge bornée le retire ensuite si Apple ne le fait pas.
    expect(Number(state.apple_registrations)).toBe(1);
    expect(Number(state.active_recovery)).toBe(0);
    expect(Number(state.push_subscriptions)).toBe(0);
    expect(Number(state.linked_events)).toBe(0);

    const [freeText] = await sql`
      select
        coalesce(string_agg(t.metadata::text,' '),'') as transaction_metadata,
        coalesce((select string_agg(a.metadata::text,' ') from audit_logs a where a.establishment_id=${card.establishment_id}),'') as audit_metadata
      from transactions t where t.card_id=${card.id}
    `;
    expect(String(freeText.transaction_metadata)).not.toContain(email);
    expect(String(freeText.transaction_metadata)).not.toContain(oldCardToken);
    expect(String(freeText.audit_metadata)).not.toContain(email);
    expect(String(freeText.audit_metadata)).not.toContain(oldCardToken);

    expect((await page.request.post("/api/scan", { headers: { origin }, data: { token: `LOY1:${oldCardToken}` } })).status()).toBe(404);
    expect((await page.request.get(`/api/card/${oldCardToken}`)).status()).toBe(404);
    expect((await page.request.post("/api/recovery/consume", { headers: { origin }, data: { token: link.token } })).status()).toBe(400);
    expect((await page.request.get(`/api/customers/${customerId}/export`)).status()).toBe(404);
    expect((await page.request.delete(`/api/customers/${customerId}`, { headers: { origin } })).status()).toBe(404);

    await page.goto("/dashboard/clients");
    await expect(page.getByText(email)).toHaveCount(0);

    await expect(sql`delete from cards where id=${card.id}`).rejects.toMatchObject({ code: "55000" });
    await expect(sql`delete from customers where id=${customerId}`).rejects.toMatchObject({ code: "55000" });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("cycle de vie établissement : suspension révoque accès, cartes, Wallets et recovery sans effacer le ledger", async ({ page }) => {
  await createMerchant(page, "lifecycle-establishment");
  const email = `${unique("closed-client")}@example.com`;
  const { cardUrl } = await enrollCustomer(page, "Sam", email);
  const oldCardToken = cardUrl.split("/c/")[1];
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });

  try {
    const [card] = await sql`select id from cards where token=${oldCardToken}`;
    const link = recoveryToken();
    await sql`
      insert into card_recovery_tokens(establishment_id,card_id,token_hash,expires_at)
      values(${restaurant.id},${card.id},${link.hash},now()+interval '15 minutes')
    `;
    const [owner] = await sql`
      select id from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1
    `;
    const resetLink = recoveryToken();
    await sql`
      insert into password_reset_tokens(staff_user_id,token_hash,expires_at)
      values(${owner.id},${resetLink.hash},now()+interval '30 minutes')
    `;
    await sql`
      insert into wallet_passes(establishment_id,card_id,provider,external_id,status)
      values(${restaurant.id},${card.id},'GOOGLE',${`object-${card.id}`},'active')
    `;
    const credit = await page.request.post("/api/credit", {
      headers: { origin },
      data: { token: `LOY1:${oldCardToken}`, idempotencyKey: crypto.randomUUID() },
    });
    expect(credit.ok()).toBeTruthy();
    const [before] = await sql`select count(*)::int as count from transactions where establishment_id=${restaurant.id}`;

    const wrong = await page.request.post("/api/restaurant/suspend", {
      headers: { origin },
      data: { confirmation: "SUSPENDRE", confirmationSlug: "mauvais-slug" },
    });
    expect(wrong.status()).toBe(409);

    const suspended = await page.request.post("/api/restaurant/suspend", {
      headers: { origin },
      data: { confirmation: "SUSPENDRE", confirmationSlug: restaurant.slug },
    });
    expect(suspended.status()).toBe(200);
    expect(await suspended.json()).toEqual({ ok: true, status: "suspended" });
    expect((await page.request.get("/api/dashboard")).status()).toBe(401);
    expect((await page.request.get(`/api/card/${oldCardToken}`)).status()).toBe(404);
    expect((await page.request.post("/api/recovery/consume", { headers: { origin }, data: { token: link.token } })).status()).toBe(400);

    const [state] = await sql`
      select
        e.status,
        (select count(*)::int from staff_users where establishment_id=e.id and active) as active_staff,
        (select count(*)::int from cards where establishment_id=e.id and active) as active_cards,
        (select count(*)::int from wallet_passes where establishment_id=e.id and status='active') as active_wallets,
        (select count(*)::int from card_recovery_tokens where establishment_id=e.id and used_at is null) as active_recovery,
        (select count(*)::int from password_reset_tokens r
          join staff_users s on s.id=r.staff_user_id
          where s.establishment_id=e.id and r.used_at is null and r.expires_at > now()) as active_password_resets,
        (select count(*)::int from transactions where establishment_id=e.id) as transactions
      from establishments e where e.id=${restaurant.id}
    `;
    expect(state.status).toBe("suspended");
    expect(Number(state.active_staff)).toBe(0);
    expect(Number(state.active_cards)).toBe(0);
    expect(Number(state.active_wallets)).toBe(0);
    expect(Number(state.active_recovery)).toBe(0);
    expect(Number(state.active_password_resets)).toBe(0);
    expect(Number(state.transactions)).toBe(Number(before.count));
    await expect(sql`delete from establishments where id=${restaurant.id}`).rejects.toMatchObject({ code: "55000" });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createEmailVerificationToken, hashEmailVerificationToken } from "../../lib/email-verification";
import { legalAcceptance, origin, testClientIp, unique } from "./helpers";

const password = "Password-test-123!";
const genericResend = {
  ok: true,
  message: "Si ce compte doit encore être vérifié, un nouveau lien vient d’être envoyé.",
};

async function signup(page: Page, label: string) {
  const marker = unique(label);
  const email = `${marker}@example.com`;
  const response = await page.request.post("/api/auth/signup", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { restaurantName: `Commerce ${marker}`, email, password, ...legalAcceptance },
  });
  expect(response.status()).toBe(202);
  const body = await response.json() as { slug: string; verificationToken: string };
  expect(body.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { email, token: body.verificationToken, slug: body.slug };
}

test("vérification e-mail : hash, expiration, usage unique et concurrence", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });
  try {
    const account = await signup(page, "email-integrity");
    const [owner] = await sql`
      select s.id, s.email_verified_at, v.token_hash, v.used_at
      from staff_users s
      join email_verification_tokens v on v.staff_user_id=s.id
      where s.email=${account.email}
    `;
    expect(owner.email_verified_at).toBeNull();
    expect(owner.used_at).toBeNull();
    expect(owner.token_hash).toBe(hashEmailVerificationToken(account.token));
    expect(owner.token_hash).not.toContain(account.token);

    const blockedLogin = await page.request.post("/api/auth/login", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { email: account.email, password },
    });
    expect(blockedLogin.status()).toBe(403);
    expect(await blockedLogin.json()).toEqual({ error: "EMAIL_NOT_VERIFIED" });

    const verified = await page.request.post("/api/auth/verify-email", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { token: account.token },
    });
    expect(verified.status()).toBe(200);

    const replay = await page.request.post("/api/auth/verify-email", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { token: account.token },
    });
    expect(replay.status()).toBe(400);
    expect(await replay.json()).toEqual({ error: "INVALID_OR_EXPIRED_LINK" });

    const malformed = await page.request.post("/api/auth/verify-email", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { token: "invalid" },
    });
    expect(malformed.status()).toBe(400);

    const expired = createEmailVerificationToken();
    await sql`
      insert into email_verification_tokens(staff_user_id,token_hash,expires_at)
      values(${owner.id},${expired.tokenHash},now() - interval '1 second')
    `;
    const expiredResponse = await page.request.post("/api/auth/verify-email", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { token: expired.token },
    });
    expect(expiredResponse.status()).toBe(400);

    const concurrent = await signup(page, "email-concurrent");
    const [first, second] = await Promise.all([
      page.request.post("/api/auth/verify-email", {
        headers: { origin, "x-real-ip": testClientIp() },
        data: { token: concurrent.token },
      }),
      page.request.post("/api/auth/verify-email", {
        headers: { origin, "x-real-ip": testClientIp() },
        data: { token: concurrent.token },
      }),
    ]);
    expect([first.status(), second.status()].sort()).toEqual([200, 400]);
    const [audit] = await sql`
      select count(*)::int as count
      from audit_logs a
      join staff_users s on s.id=a.staff_user_id
      where s.email=${concurrent.email} and a.action='EMAIL_VERIFIED'
    `;
    expect(audit.count).toBe(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("renvoi : réponse générique, limite anti-spam et un seul token actif", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });
  try {
    const account = await signup(page, "email-resend-integrity");
    const headers = { origin, "x-real-ip": testClientIp() };
    const unknown = await page.request.post("/api/auth/resend-verification", {
      headers,
      data: { email: `${unique("unknown")}@example.com` },
    });
    expect(unknown.status()).toBe(202);
    expect(await unknown.json()).toEqual(genericResend);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await page.request.post("/api/auth/resend-verification", {
        headers,
        data: { email: account.email },
      });
      expect(response.status()).toBe(202);
      expect(await response.json()).toEqual(genericResend);
    }

    await expect.poll(async () => {
      const [row] = await sql`
        select
          (select count(*)::int from email_verification_tokens v where v.staff_user_id=s.id and v.used_at is null) as active,
          (select count(*)::int from audit_logs a where a.staff_user_id=s.id and a.action='EMAIL_VERIFICATION_EMAIL_SENT' and a.metadata->>'resend'='true') as resends
        from staff_users s where s.email=${account.email}
      `;
      return { active: Number(row.active), resends: Number(row.resends) };
    }, { timeout: 10_000 }).toEqual({ active: 1, resends: 5 });

    const oldToken = await page.request.post("/api/auth/verify-email", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { token: account.token },
    });
    expect(oldToken.status()).toBe(400);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("un compte désactivé ou suspendu ne récupère jamais son ancien lien", async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const disabled = await signup(page, "email-disabled");
    await sql`update staff_users set active=false where email=${disabled.email}`;
    await sql`update staff_users set active=true where email=${disabled.email}`;
    const disabledLink = await page.request.post("/api/auth/verify-email", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { token: disabled.token },
    });
    expect(disabledLink.status()).toBe(400);

    const suspended = await signup(page, "email-suspended");
    await sql`update establishments set status='suspended' where slug=${suspended.slug}`;
    await sql`update establishments set status='active' where slug=${suspended.slug}`;
    const suspendedLink = await page.request.post("/api/auth/verify-email", {
      headers: { origin, "x-real-ip": testClientIp() },
      data: { token: suspended.token },
    });
    expect(suspendedLink.status()).toBe(400);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

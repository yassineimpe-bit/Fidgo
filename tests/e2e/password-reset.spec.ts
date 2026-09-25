import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, randomizeClientIp, testClientIp, unique } from "./helpers";

function resetToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

async function waitFor<T>(read: () => Promise<T | undefined | null>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

// page.setExtraHTTPHeaders() (posé par randomizeClientIp sur les navigations
// via createMerchant/page.goto) n'est pas repris par page.request, qui est un
// client HTTP indépendant : chaque appel direct à un endpoint limité par IP
// doit donc porter son propre x-real-ip explicite pour rester isolé des
// autres tests de ce fichier.
function ipHeaders() {
  return { origin, "x-real-ip": testClientIp() };
}

test.describe("mot de passe oublié", () => {
  test("réponse identique qu'un compte existe ou non, jamais 429 distinguable", async ({ page }) => {
    await createMerchant(page, "reset-generic");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    let knownEmail: string;
    try {
      const [staff] = await sql`select email from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;
      knownEmail = String(staff.email);
    } finally {
      await sql.end({ timeout: 5 });
    }

    const headers = ipHeaders();
    const withAccount = await page.request.post("/api/auth/forgot-password", {
      headers,
      data: { email: knownEmail },
    });
    const withoutAccount = await page.request.post("/api/auth/forgot-password", {
      headers,
      data: { email: `${unique("nobody")}@example.com` },
    });

    expect(withAccount.status()).toBe(withoutAccount.status());
    expect(await withAccount.json()).toEqual(await withoutAccount.json());
    expect(withAccount.headers()["cache-control"]).toContain("no-store");
  });

  test("email invalide rejeté avant toute recherche", async ({ page }) => {
    const response = await page.request.post("/api/auth/forgot-password", {
      headers: ipHeaders(),
      data: { email: "not-an-email" },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_INPUT" });
  });

  test("token créé et hashé en base pour un compte valide, jamais en clair", async ({ page }) => {
    await createMerchant(page, "reset-created");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    try {
      const [staff] = await sql`select id, email from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;
      expect(staff).toBeTruthy();

      await page.request.post("/api/auth/forgot-password", {
        headers: ipHeaders(),
        data: { email: staff.email },
      });

      const row = await waitFor(async () => {
        const [found] = await sql`select token_hash from password_reset_tokens where staff_user_id=${staff.id} limit 1`;
        return found;
      });
      expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("une demande publique de reset ne verrouille jamais le compte ni ses sessions", async ({ page, playwright }) => {
    await createMerchant(page, "reset-no-lockout");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    // Un tiers, sans session, qui connaît seulement l'e-mail du titulaire.
    const stranger = await playwright.request.newContext({ baseURL: origin });
    try {
      const [before] = await sql`select id, email, password_hash, token_version from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await stranger.post("/api/auth/forgot-password", { headers: ipHeaders(), data: { email: before.email } });
        expect(response.status()).toBe(202);
      }

      const [after] = await sql`select password_hash, token_version from staff_users where id=${before.id}`;
      expect(after.password_hash).toBe(before.password_hash);
      expect(Number(after.token_version)).toBe(Number(before.token_version));

      // La session ouverte reste valide et le mot de passe actuel fonctionne toujours.
      expect((await page.request.get("/api/restaurant")).status()).toBe(200);
      const login = await stranger.post("/api/auth/login", {
        headers: ipHeaders(),
        data: { email: before.email, password: "Password-test-123!" },
      });
      expect(login.status()).toBe(200);
    } finally {
      await stranger.dispose();
      await sql.end({ timeout: 5 });
    }
  });

  test("utilisateur désactivé : aucun token créé", async ({ page }) => {
    await createMerchant(page, "reset-disabled");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    try {
      const [staff] = await sql`select id, email from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;
      await sql`update staff_users set active=false where id=${staff.id}`;

      const response = await page.request.post("/api/auth/forgot-password", {
        headers: ipHeaders(),
        data: { email: staff.email },
      });
      expect(response.status()).toBe(202);

      // Laisse le temps à un éventuel traitement en arrière-plan de s'exécuter :
      // aucune ligne ne doit apparaître pour un compte désactivé.
      await page.waitForTimeout(500);
      const [row] = await sql`select id from password_reset_tokens where staff_user_id=${staff.id}`;
      expect(row).toBeFalsy();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("établissement suspendu : aucun token créé", async ({ page }) => {
    await createMerchant(page, "reset-suspended");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    try {
      const [staff] = await sql`select id, email from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;
      await sql`update establishments set status='suspended' where id=${restaurant.id}`;

      const response = await page.request.post("/api/auth/forgot-password", {
        headers: ipHeaders(),
        data: { email: staff.email },
      });
      expect(response.status()).toBe(202);

      await page.waitForTimeout(500);
      const [row] = await sql`select id from password_reset_tokens where staff_user_id=${staff.id}`;
      expect(row).toBeFalsy();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

test.describe("réinitialisation du mot de passe", () => {
  test("token expiré, déjà utilisé ou invalide sont tous rejetés", async ({ page }) => {
    await createMerchant(page, "reset-invalid-tokens");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    const headers = ipHeaders();
    try {
      const [staff] = await sql`select id from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;

      const expired = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at) values(${staff.id}, ${expired.hash}, now() - interval '1 minute')`;
      const expiredResponse = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: expired.token, password: "New-Password-123!" },
      });
      expect(expiredResponse.status()).toBe(400);
      expect(await expiredResponse.json()).toEqual({ error: "INVALID_OR_EXPIRED_LINK" });

      const used = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at, used_at) values(${staff.id}, ${used.hash}, now() + interval '30 minutes', now())`;
      const usedResponse = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: used.token, password: "New-Password-123!" },
      });
      expect(usedResponse.status()).toBe(400);
      expect(await usedResponse.json()).toEqual({ error: "INVALID_OR_EXPIRED_LINK" });

      const wrongResponse = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: "a".repeat(43), password: "New-Password-123!" },
      });
      expect(wrongResponse.status()).toBe(400);
      expect(await wrongResponse.json()).toEqual({ error: "INVALID_OR_EXPIRED_LINK" });

      const shortPassword = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at) values(${staff.id}, ${shortPassword.hash}, now() + interval '30 minutes')`;
      const invalidPasswordResponse = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: shortPassword.token, password: "short1" },
      });
      expect(invalidPasswordResponse.status()).toBe(400);
      expect(await invalidPasswordResponse.json()).toEqual({ error: "INVALID_INPUT" });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("reset valide change le mot de passe, invalide les sessions et empêche tout replay", async ({ page }) => {
    await createMerchant(page, "reset-valid");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    const headers = ipHeaders();
    try {
      const [before] = await sql`select id, email, password_hash, token_version from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;

      const link = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at) values(${before.id}, ${link.hash}, now() + interval '30 minutes')`;

      const resetResponse = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: link.token, password: "New-Password-456!" },
      });
      expect(resetResponse.status()).toBe(200);
      expect(await resetResponse.json()).toEqual({ ok: true });

      const [after] = await sql`select password_hash, token_version from staff_users where id=${before.id}`;
      expect(after.password_hash).not.toBe(before.password_hash);
      expect(Number(after.token_version)).toBe(Number(before.token_version) + 1);

      const [tokenRow] = await sql`select used_at is not null as consumed from password_reset_tokens where token_hash=${link.hash}`;
      expect(tokenRow.consumed).toBe(true);

      const [audit] = await sql`select count(*)::int as count from audit_logs where action='PASSWORD_RESET_COMPLETED' and staff_user_id=${before.id}`;
      expect(Number(audit.count)).toBe(1);

      // Rejoue le même token : impossible une seconde fois.
      const replay = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: link.token, password: "Another-Password-789!" },
      });
      expect(replay.status()).toBe(400);
      expect(await replay.json()).toEqual({ error: "INVALID_OR_EXPIRED_LINK" });

      // L'ancien mot de passe ne fonctionne plus, le nouveau oui.
      const oldPasswordLogin = await page.request.post("/api/auth/login", {
        headers,
        data: { email: before.email, password: "Password-test-123!" },
      });
      expect(oldPasswordLogin.status()).toBe(401);

      const newPasswordLogin = await page.request.post("/api/auth/login", {
        headers,
        data: { email: before.email, password: "New-Password-456!" },
      });
      expect(newPasswordLogin.status()).toBe(200);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("un nouveau reset invalide les autres tokens actifs du même utilisateur", async ({ page }) => {
    await createMerchant(page, "reset-invalidate-others");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    const headers = ipHeaders();
    try {
      const [staff] = await sql`select id from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;

      const older = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at) values(${staff.id}, ${older.hash}, now() + interval '30 minutes')`;
      const newer = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at) values(${staff.id}, ${newer.hash}, now() + interval '30 minutes')`;

      const response = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: newer.token, password: "Fresh-Password-321!" },
      });
      expect(response.status()).toBe(200);

      const [olderRow] = await sql`select used_at is not null as consumed from password_reset_tokens where token_hash=${older.hash}`;
      expect(olderRow.consumed).toBe(true);

      const replayOlder = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: older.token, password: "Should-Not-Work-000!" },
      });
      expect(replayOlder.status()).toBe(400);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("token valide mais établissement suspendu entre-temps : reset refusé", async ({ page }) => {
    await createMerchant(page, "reset-token-then-suspended");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    try {
      const [staff] = await sql`select id from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;
      const link = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at) values(${staff.id}, ${link.hash}, now() + interval '30 minutes')`;

      const suspended = await page.request.post("/api/restaurant/suspend", {
        headers: { origin },
        data: { confirmation: "SUSPENDRE", confirmationSlug: restaurant.slug },
      });
      expect(suspended.status()).toBe(200);

      const response = await page.request.post("/api/auth/reset-password", {
        headers: ipHeaders(),
        data: { token: link.token, password: "Should-Not-Apply-999!" },
      });
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_OR_EXPIRED_LINK" });

      const [tokenState] = await sql`
        select used_at is not null as consumed from password_reset_tokens where token_hash=${link.hash}
      `;
      expect(tokenState.consumed).toBe(true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("concurrence : une seule des deux tentatives simultanées sur le même token réussit", async ({ page }) => {
    await createMerchant(page, "reset-concurrent");
    const restaurant = await page.request.get("/api/restaurant").then((r) => r.json());
    const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
    const headers = ipHeaders();
    try {
      const [staff] = await sql`select id, token_version from staff_users where establishment_id=${restaurant.id} and role='OWNER' limit 1`;
      const link = resetToken();
      await sql`insert into password_reset_tokens(staff_user_id, token_hash, expires_at) values(${staff.id}, ${link.hash}, now() + interval '30 minutes')`;

      const [first, second] = await Promise.all([
        page.request.post("/api/auth/reset-password", { headers, data: { token: link.token, password: "Concurrent-One-111!" } }),
        page.request.post("/api/auth/reset-password", { headers, data: { token: link.token, password: "Concurrent-Two-222!" } }),
      ]);

      expect([first.status(), second.status()].sort()).toEqual([200, 400]);

      const [after] = await sql`select token_version from staff_users where id=${staff.id}`;
      expect(Number(after.token_version)).toBe(Number(staff.token_version) + 1);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("rate limit sur la consommation du token", async ({ page }) => {
    const headers = ipHeaders();
    let limited = false;
    for (let i = 0; i < 25; i += 1) {
      const response = await page.request.post("/api/auth/reset-password", {
        headers,
        data: { token: "a".repeat(43), password: "Whatever-Password-1!" },
      });
      if (response.status() === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});

test.describe("pages mot de passe oublié / réinitialisation", () => {
  test("le lien depuis /login mène à /forgot-password, le formulaire répond de façon générique", async ({ page }) => {
    await randomizeClientIp(page);
    await page.goto("/login");
    await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
    // Première compilation de la page en dev : la navigation peut dépasser 5 s.
    await expect(page).toHaveURL(/\/forgot-password$/, { timeout: 15_000 });

    await page.getByLabel("Email").fill(`${unique("ui-forgot")}@example.com`);
    await page.getByRole("button", { name: "Envoyer le lien de réinitialisation" }).click();
    await expect(page.getByText("Si un compte correspond à cette adresse e-mail, un lien de réinitialisation vient d’être envoyé.")).toBeVisible();
  });

  test("/reset-password sans jeton valide affiche un message d'erreur clair", async ({ page }) => {
    await randomizeClientIp(page);
    await page.goto("/reset-password");
    await expect(page.getByText("Ce lien de réinitialisation est invalide.")).toBeVisible();
  });

  test("/reset-password avec un jeton bien formé affiche le formulaire et refuse un mauvais token à l'envoi", async ({ page }) => {
    await randomizeClientIp(page);
    await page.goto(`/reset-password?token=${"a".repeat(43)}`);
    await page.getByLabel("Nouveau mot de passe").fill("Whatever-Password-1!");
    await page.getByLabel("Confirmer le mot de passe").fill("Whatever-Password-1!");
    await page.getByRole("button", { name: "Réinitialiser le mot de passe" }).click();
    await expect(page.getByText("Ce lien a expiré ou a déjà été utilisé.")).toBeVisible();
  });
});

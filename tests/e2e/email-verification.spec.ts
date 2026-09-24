import { expect, test } from "@playwright/test";
import { origin, testClientIp, unique } from "./helpers";

test("email verification : une inscription non vérifiée ne permet pas le pré-détournement du compte", async ({ page }) => {
  const marker = unique("pre-hijack");
  const email = `${marker}@example.com`;
  const attackerPassword = "Attacker-test-123!";
  const legitimatePassword = "Legitimate-test-456!";
  const headers = { origin, "x-real-ip": testClientIp() };

  const attackerSignup = await page.request.post("/api/auth/signup", {
    headers,
    data: {
      restaurantName: "Commerce pirate temporaire",
      email,
      password: attackerPassword,
    },
  });
  expect(attackerSignup.status()).toBe(202);
  const attackerBody = await attackerSignup.json() as { verificationToken?: string };
  expect(attackerBody.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const legitimateSignup = await page.request.post("/api/auth/signup", {
    headers,
    data: {
      restaurantName: "Commerce légitime",
      email,
      password: legitimatePassword,
    },
  });
  expect(legitimateSignup.status()).toBe(202);
  const legitimateBody = await legitimateSignup.json() as { verificationToken?: string };
  expect(legitimateBody.verificationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(legitimateBody.verificationToken).not.toBe(attackerBody.verificationToken);

  const oldToken = await page.request.post("/api/auth/verify-email", {
    headers: { origin },
    data: { token: attackerBody.verificationToken, password: attackerPassword },
  });
  expect(oldToken.status()).toBe(400);
  expect((await oldToken.json()).error).toBe("INVALID_OR_EXPIRED_LINK");

  const stolenPasswordOnNewToken = await page.request.post("/api/auth/verify-email", {
    headers: { origin },
    data: { token: legitimateBody.verificationToken, password: attackerPassword },
  });
  expect(stolenPasswordOnNewToken.status()).toBe(401);
  expect((await stolenPasswordOnNewToken.json()).error).toBe("INVALID_CREDENTIALS");

  const verified = await page.request.post("/api/auth/verify-email", {
    headers: { origin },
    data: { token: legitimateBody.verificationToken, password: legitimatePassword },
  });
  expect(verified.ok()).toBeTruthy();

  const attackerLogin = await page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { email, password: attackerPassword },
  });
  expect(attackerLogin.status()).toBe(401);

  const legitimateLogin = await page.request.post("/api/auth/login", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: { email, password: legitimatePassword },
  });
  expect(legitimateLogin.ok()).toBeTruthy();

  const overwriteVerified = await page.request.post("/api/auth/signup", {
    headers: { origin, "x-real-ip": testClientIp() },
    data: {
      restaurantName: "Tentative d’écrasement",
      email,
      password: "Another-test-789!",
    },
  });
  expect(overwriteVerified.status()).toBe(409);
  expect((await overwriteVerified.json()).error).toBe("EMAIL_EXISTS");
});

test("email verification : la page qui transporte le jeton est privée et non indexable", async ({ page }) => {
  const response = await page.goto(`/verify-email?token=${"A".repeat(43)}`);
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["x-robots-tag"]).toContain("nofollow");
});

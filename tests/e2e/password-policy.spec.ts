import { expect, test } from "@playwright/test";
import { origin, randomizeClientIp, unique } from "./helpers";

// bcrypt tronque silencieusement tout au-delà de 72 octets : sans ce garde-fou,
// deux mots de passe partageant les 72 mêmes premiers octets produiraient le
// même hash. Vérifié directement sur /api/auth/signup, qui partage la
// politique avec /api/auth/reset-password (lib/password-reset.ts).
test("signup refuse un mot de passe dépassant la limite bcrypt de 72 octets", async ({ page }) => {
  await randomizeClientIp(page);
  const marker = unique("password-policy");

  const tooLong = await page.request.post("/api/auth/signup", {
    headers: { origin },
    data: {
      restaurantName: `Commerce ${marker}`,
      email: `${marker}@example.com`,
      password: "a".repeat(73),
    },
  });
  expect(tooLong.status()).toBe(400);
  expect(await tooLong.json()).toEqual({ error: "INVALID_INPUT" });

  const exactly72 = await page.request.post("/api/auth/signup", {
    headers: { origin },
    data: {
      restaurantName: `Commerce ${marker}`,
      email: `${marker}@example.com`,
      password: "a".repeat(72),
    },
  });
  expect(exactly72.status()).toBe(202);
});

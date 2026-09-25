import { expect, test } from "@playwright/test";

test("health : la base et le schéma requis sont prêts", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);

  const body = await response.json();
  expect(body).toMatchObject({
    ok: true,
    service: "retiko",
    database: "up",
    schema: "up",
    auth: "up",
    email: { recovery: true, passwordReset: true, verification: true },
  });
});

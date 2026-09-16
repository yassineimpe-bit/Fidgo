import { expect, test } from "@playwright/test";
import { createMerchant, enrollCustomer, origin, unique } from "./helpers";

test("une récompense ne peut être consommée que par une session staff", async ({ page, request }) => {
  await createMerchant(page, "redeem-auth");
  const { cardUrl } = await enrollCustomer(page, "Lina", `${unique("redeem-client")}@example.com`);
  const token = cardUrl.split("/c/")[1];

  // `request` est un contexte API séparé et ne partage pas le cookie de la
  // session staff créée dans `page`.
  const response = await request.post("/api/redeem", {
    headers: { origin },
    data: { token, idempotencyKey: crypto.randomUUID() },
  });

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ error: "UNAUTHORIZED" });
});

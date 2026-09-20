import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant } from "./helpers";

test("clients : pagination serveur au-delà de 50 clients", async ({ page }) => {
  await createMerchant(page, "client-pagination");
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      insert into customers(establishment_id,email,first_name)
      select
        ${restaurant.id},
        'pagination-' || n::text || '@example.com',
        'Client ' || lpad(n::text, 2, '0')
      from generate_series(1,55) as n
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  await page.goto("/dashboard/clients");
  await expect(page.getByText("55 clients · page 1/2")).toBeVisible();
  await expect(page.getByRole("link", { name: "Suivant →" })).toBeVisible();

  await page.getByRole("link", { name: "Suivant →" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("55 clients · page 2/2")).toBeVisible();
  await expect(page.getByRole("link", { name: "← Précédent" })).toBeVisible();
});

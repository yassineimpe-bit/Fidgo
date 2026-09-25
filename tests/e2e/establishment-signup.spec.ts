import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, legalAcceptance, origin, unique } from "./helpers";

test("création établissement : compte, OWNER, programme et essai sont atomiques", async ({ page }) => {
  const marker = unique("establishment-signup");
  await createMerchant(page, marker);
  await expect(page).toHaveURL(/\/dashboard$/);
  const joinPath = await page.locator("code").filter({ hasText: "/j/" }).textContent();
  expect(joinPath).toMatch(/^\/j\/[a-z0-9-]+$/);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const rows = await sql`
      select e.id,e.slug,e.name,e.status,
        s.id as owner_id,s.email as owner_email,s.role,s.active as owner_active,
        p.mode,p.reward_threshold,p.active as program_active,
        sub.plan,sub.status as subscription_status
      from establishments e
      join staff_users s on s.establishment_id=e.id and s.role='OWNER'
      join loyalty_programs p on p.establishment_id=e.id
      join subscriptions sub on sub.establishment_id=e.id
      where e.slug=${joinPath!.slice(3)}
    `;
    expect(rows).toHaveLength(1);
    expect(String(rows[0].name)).toContain(marker);
    expect(rows[0]).toMatchObject({
      status: "active", role: "OWNER", owner_active: true,
      mode: "STAMPS", reward_threshold: 10, program_active: true,
      plan: "PILOT", subscription_status: "trial",
    });
    expect(joinPath).toBe(`/j/${rows[0].slug}`);
    expect((await sql`select count(*)::int as count from staff_users where establishment_id=${rows[0].id}`)[0].count).toBe(1);

    const duplicateName = `Commerce ${unique("duplicate-establishment")}`;
    const duplicate = await page.request.post("/api/auth/signup", {
      headers: { origin },
      data: {
        ...legalAcceptance,
        restaurantName: duplicateName,
        email: String(rows[0].owner_email),
        password: "Password-test-123!",
      },
    });
    expect(duplicate.status()).toBe(409);
    expect((await duplicate.json()).error).toBe("EMAIL_EXISTS");
    expect((await sql`select count(*)::int as count from establishments where name=${duplicateName}`)[0].count).toBe(0);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

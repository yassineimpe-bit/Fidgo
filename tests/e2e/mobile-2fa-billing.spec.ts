import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { base32Decode, totpCode, totpStep } from "../../lib/totp";
import { createMerchant } from "./helpers";

test.describe.configure({ timeout: 90_000 });

test("2FA : un code collé avec une espace est accepté, cibles tactiles ≥ 44 px", async ({ page }) => {
  await createMerchant(page, "twofa-paste");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/dashboard/security");
  await page.getByRole("button", { name: "Activer la double authentification" }).click();
  await page.locator("#two-factor-password").fill("Password-test-123!");
  await page.getByRole("button", { name: "Continuer" }).click();
  const secret = (await page.getByTestId("two-factor-secret").textContent())!.trim();
  const code = totpCode(base32Decode(secret)!, totpStep());

  const input = page.getByLabel("2. Code à 6 chiffres affiché par l’application");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).toHaveAttribute("maxlength", "6");
  // Sans nettoyage, la limite de 6 caractères tronquerait « 123 456 » en « 123 45 ».
  await input.evaluate((element, pasted) => {
    const data = new DataTransfer();
    data.setData("text", pasted);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, `${code.slice(0, 3)} ${code.slice(3)}`);
  await expect(input).toHaveValue(code);

  const submit = page.getByRole("button", { name: "Activer la double authentification" });
  expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await submit.click();
  await expect(page.getByRole("list", { name: "Codes de secours" }).getByRole("listitem")).toHaveCount(10);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("facturation : essai, paiement en retard et résiliation programmée en langage clair", async ({ page }) => {
  await createMerchant(page, "billing-states");
  const slug = String((await page.request.get("/api/restaurant").then((response) => response.json())).slug);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const setState = (fields: { status: string; trialDays?: number | null; periodDays?: number | null; cancel?: boolean }) => sql`
    update subscriptions s set
      status = ${fields.status},
      trial_ends_at = case when ${fields.trialDays ?? null}::int is null then null else now() + make_interval(days => ${fields.trialDays ?? 0}) end,
      current_period_end = case when ${fields.periodDays ?? null}::int is null then null else now() + make_interval(days => ${fields.periodDays ?? 0}) end,
      cancel_at_period_end = ${fields.cancel ?? false}
    from establishments e where e.id = s.establishment_id and e.slug = ${slug}
  `;
  const message = page.getByTestId("billing-status-message");
  try {
    await setState({ status: "trial", trialDays: 10 });
    await page.goto("/dashboard/billing");
    await expect(message).toContainText("10 jours d’essai restants");

    await setState({ status: "trial", trialDays: -2 });
    await page.reload();
    await expect(page.getByText("Essai terminé")).toBeVisible();
    await expect(message).toContainText("La période d’essai s’est terminée");

    await setState({ status: "past_due", periodDays: 5 });
    await page.reload();
    await expect(page.getByText("Paiement en retard")).toBeVisible();
    await expect(message).toContainText("Mets à jour ton moyen de paiement");
    await expect(message).not.toContainText(/stripe/i);

    await setState({ status: "active", periodDays: 20, cancel: true });
    await page.reload();
    await expect(page.getByText("Résiliation programmée")).toBeVisible();
    await expect(message).toContainText("L’abonnement reste actif jusqu’au");
  } finally {
    await sql.end({ timeout: 5 });
  }
});

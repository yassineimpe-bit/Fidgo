import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { contrastTextColor } from "../../lib/brand-color";
import { origin, testClientIp, unique } from "./helpers";

const BRAND_NAME = "Le Café d'Ussel";
const BRAND_COLOR = "#7A3E2D";
const REWARD_LABEL = "Le 11e offert";

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
}

/**
 * Parcours complet du commerçant fictif demandé par la mission branding :
 * inscription -> couleur + programme -> affiche -> inscription client brandée
 * -> carte client brandée. Un seul commerce est créé dans beforeAll et son
 * état de session (storageState) est réutilisé par chaque test pour éviter
 * de refaire l'onboarding à chaque cas.
 */
test.describe("branding commerce : Le Café d'Ussel", () => {
  let merchantContext: BrowserContext;
  let merchantPage: Page;
  let slug = "";
  let joinUrl = "";

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    merchantContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    merchantPage = await merchantContext.newPage();

    const marker = unique("cafe-ussel");
    await merchantPage.goto("/signup");
    await merchantPage.getByLabel("Nom du commerce").fill(BRAND_NAME);
    await merchantPage.getByLabel("Email").fill(`${marker}@example.com`);
    await merchantPage.getByLabel("Mot de passe").fill("Password-test-123!");
    await merchantPage.getByRole("button", { name: "Créer mon espace" }).click();
    await expect(merchantPage).toHaveURL(/\/dashboard$/);

    // Programme : 10 cafés = le 11e offert (le seuil par défaut est déjà 10).
    await merchantPage.goto("/dashboard/program");
    await merchantPage.getByLabel("Récompense", { exact: true }).fill(REWARD_LABEL);
    await merchantPage.getByRole("button", { name: "Enregistrer" }).click();
    await expect(merchantPage.getByText("Programme enregistré.")).toBeVisible();

    await merchantPage.goto("/dashboard/settings");
    await merchantPage.getByLabel("Code hexadécimal de la couleur").fill(BRAND_COLOR);
    await merchantPage.getByRole("button", { name: "Enregistrer" }).click();
    await expect(merchantPage.getByText("Commerce enregistré.")).toBeVisible();

    await merchantPage.goto("/dashboard/poster");
    const urlText = await merchantPage.locator("p.no-print.muted").textContent();
    expect(urlText).toMatch(new RegExp(`${origin}/j/`));
    joinUrl = urlText!.trim();
    slug = joinUrl.split("/j/")[1];
    expect(slug).toBeTruthy();
  });

  test.afterAll(async () => {
    await merchantContext?.close();
  });

  test("dashboard : la couleur choisie se reflète en direct dans l'aperçu avant même l'enregistrement", async () => {
    // Un second passage sur les réglages, cette fois pour vérifier le
    // temps réel (mission item 5) plutôt que la persistance déjà prouvée
    // dans beforeAll : on change la couleur sans cliquer sur Enregistrer.
    await merchantPage.goto("/dashboard/settings");
    const hexInput = merchantPage.getByLabel("Code hexadécimal de la couleur");
    const preview = merchantPage.locator('[aria-label="Aperçu de la carte fidélité"]');

    await hexInput.fill("#0000FF");
    await expect(preview).toHaveCSS("background-color", "rgb(0, 0, 255)");
    await expect(preview.getByText(BRAND_NAME)).toBeVisible();
    await expect(preview.getByText(REWARD_LABEL)).toBeVisible();

    // On revient sur la couleur réellement enregistrée pour ne pas fausser
    // les tests suivants qui dépendent de BRAND_COLOR en base.
    await hexInput.fill(BRAND_COLOR);
    await expect(preview).toHaveCSS("background-color", hexToRgb(BRAND_COLOR));
    // #7A3E2D est sombre : le texte doit basculer en blanc, jamais rester
    // noir (illisible) ni casser sur une couleur imprévue.
    expect(contrastTextColor(BRAND_COLOR)).toBe("#ffffff");
    await expect(preview).toHaveCSS("color", "rgb(255, 255, 255)");
  });

  test("affiche : formats et styles reprennent la couleur et affichent le vrai QR", async () => {
    await merchantPage.goto("/dashboard/poster");

    await expect(merchantPage.locator(".poster")).toContainText(BRAND_NAME);
    await expect(merchantPage.locator(".poster")).toContainText("Votre fidélité, directement sur votre téléphone");
    await expect(merchantPage.locator(".poster")).toContainText("Scannez pour créer votre carte");
    await expect(merchantPage.locator(".poster")).toContainText("10 passages");
    await expect(merchantPage.locator(".poster")).toContainText(REWARD_LABEL);
    await expect(merchantPage.locator(".poster")).toContainText("Propulsé par Retiko");
    await expect(merchantPage.locator(".poster img[alt*='QR code']")).toBeVisible();

    // Format + style par défaut : A4, minimal (fond blanc, couleur en accent).
    await expect(merchantPage.locator(".poster")).toHaveClass(/poster--a4/);
    await expect(merchantPage.locator(".poster")).toHaveClass(/poster--minimal/);
    await expect(merchantPage.locator(".poster")).toHaveCSS("background-color", "rgb(255, 255, 255)");

    // Bascule en A5, puis chevalet : le même contenu doit rester présent.
    await merchantPage.getByRole("button", { name: /A5/ }).click();
    await expect(merchantPage.locator(".poster")).toHaveClass(/poster--a5/);
    await expect(merchantPage.locator(".poster")).toContainText(BRAND_NAME);

    await merchantPage.getByRole("button", { name: /Chevalet/ }).click();
    await expect(merchantPage.locator(".poster")).toHaveClass(/poster--chevalet/);

    // Style "Contrasté" : le fond devient la couleur de marque, avec un texte
    // recalculé pour rester lisible (jamais blanc sur blanc).
    await merchantPage.getByRole("button", { name: "Contrasté" }).click();
    await expect(merchantPage.locator(".poster")).toHaveClass(/poster--contrasted/);
    await expect(merchantPage.locator(".poster")).toHaveCSS("background-color", hexToRgb(BRAND_COLOR));
    await expect(merchantPage.locator(".poster")).toHaveCSS("color", "rgb(255, 255, 255)");

    // Remet le format par défaut pour ne pas influencer une capture d'écran ultérieure.
    await merchantPage.getByRole("button", { name: "A4 · vitrine / mur" }).click();
    await merchantPage.getByRole("button", { name: "Minimal" }).click();
  });

  test("inscription client : la page /j/[slug] est brandée et reste lisible", async () => {
    const clientPage = await merchantContext.newPage();
    try {
      await clientPage.goto(`/j/${slug}`);
      await expect(clientPage.getByRole("heading", { name: BRAND_NAME })).toBeVisible();
      await expect(clientPage.getByText(REWARD_LABEL)).toBeVisible();
      // Le formulaire doit rester lisible : labels et bouton toujours visibles
      // malgré le fond teinté par la couleur du commerce.
      await expect(clientPage.getByLabel("Email")).toBeVisible();
      await expect(clientPage.getByRole("button", { name: "Créer ma carte" })).toBeVisible();
      expect(await clientPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    } finally {
      await clientPage.close();
    }
  });

  test("carte client : reprend la couleur du commerce avec un texte toujours lisible", async () => {
    const clientPage = await merchantContext.newPage();
    try {
      const marker = unique("client-cafe-ussel");
      await clientPage.goto(`/j/${slug}`);
      await clientPage.getByLabel(/Prénom/).fill("Client");
      await clientPage.getByLabel("Email").fill(`${marker}@example.com`);
      await clientPage.getByRole("button", { name: "Créer ma carte" }).click();
      await expect(clientPage).toHaveURL(/\/c\//);

      const card = clientPage.locator(".loyalty-card");
      await expect(card).toContainText(BRAND_NAME);
      await expect(card).toContainText(REWARD_LABEL);
      await expect(card.locator("img[alt='QR code fidélité']")).toBeVisible();
      await expect(card).toHaveCSS("background-color", hexToRgb(BRAND_COLOR));
      // Bug corrigé dans cette mission : .loyalty-card imposait `color:white`
      // en dur. #7A3E2D est sombre, donc le blanc reste ici le bon choix, mais
      // c'est bien le calcul qui le décide (voir brand-color.test.ts pour le
      // cas d'une couleur claire, où ce serait faux avant le correctif).
      await expect(card).toHaveCSS("color", "rgb(255, 255, 255)");

      expect(await clientPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    } finally {
      await clientPage.close();
    }
  });
});

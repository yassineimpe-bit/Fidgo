import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { contrastTextColor } from "../../lib/brand-color";
import { origin, testClientIp, unique } from "./helpers";

const BRAND_NAME = "Le Café d'Ussel";
const BRAND_COLOR = "#7A3E2D";
const REWARD_LABEL = "Le 11e offert";
const LOGO_URL = "https://example.com/retiko-test-logo.png";

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return `rgb(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)})`;
}

// 1mm = 96/25.4 px, unité CSS absolue indépendante du DPI réel de
// l'imprimante : c'est ce que le moteur de rendu du navigateur utilise pour
// convertir `width:210mm` en pixels, print ou pas. Tolérance de 3px pour les
// arrondis de sous-pixel du moteur de rendu.
const MM_TO_PX = 96 / 25.4;
const SIZE_TOLERANCE_PX = 3;

function expectMm(actualPx: number, expectedMm: number, label: string) {
  const expectedPx = expectedMm * MM_TO_PX;
  expect(Math.abs(actualPx - expectedPx), `${label} : attendu ~${expectedPx.toFixed(1)}px (${expectedMm}mm), obtenu ${actualPx.toFixed(1)}px`).toBeLessThanOrEqual(SIZE_TOLERANCE_PX);
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
    await merchantContext.route(LOGO_URL, (route) => route.fulfill({ path: `${process.cwd()}/public/icon-192.png`, contentType: "image/png" }));
    merchantPage = await merchantContext.newPage();

    const marker = unique("cafe-ussel");
    await merchantPage.goto("/signup");
    await merchantPage.getByLabel("Nom du commerce").fill(BRAND_NAME);
    await merchantPage.getByLabel("Email").fill(`${marker}@example.com`);
    await merchantPage.getByLabel("Mot de passe").fill("Password-test-123!");
    await merchantPage.getByRole("button", { name: "Créer mon espace" }).click();
    await expect(merchantPage).toHaveURL(/\/onboarding$/);

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

  test("identité : logo et coordonnées persistent, et une requête invalide ne les efface pas", async () => {
    await merchantPage.goto("/dashboard/settings");
    await merchantPage.getByLabel("URL du logo").fill(LOGO_URL);
    await merchantPage.getByLabel("Adresse").fill("12 rue de la République, 19200 Ussel");
    await merchantPage.getByLabel("Téléphone").fill("05 55 00 00 00");
    await merchantPage.getByLabel("Instagram").fill("@cafe_ussel");
    await merchantPage.getByLabel("Site web").fill("https://example.com/cafe");
    await merchantPage.getByRole("button", { name: "Enregistrer" }).click();
    await expect(merchantPage.getByText("Commerce enregistré.")).toBeVisible();

    await merchantPage.reload();
    await expect(merchantPage.getByLabel("URL du logo")).toHaveValue(LOGO_URL);
    await expect(merchantPage.getByLabel("Adresse")).toHaveValue("12 rue de la République, 19200 Ussel");
    await expect(merchantPage.getByLabel("Téléphone")).toHaveValue("05 55 00 00 00");
    await expect(merchantPage.getByLabel("Instagram")).toHaveValue("@cafe_ussel");
    await expect(merchantPage.getByLabel("Site web")).toHaveValue("https://example.com/cafe");

    for (const data of [
      { logoUrl: "http://example.com/logo.png" },
      { website: "javascript:alert(1)" },
      { primaryColor: "red" },
      { name: "  " },
    ]) {
      const rejected = await merchantPage.request.patch("/api/restaurant", {
        headers: { origin }, data,
      });
      expect(rejected.status()).toBe(400);
    }
    // Un PATCH partiel légitime n'efface pas non plus les autres réglages.
    const partial = await merchantPage.request.patch("/api/restaurant", {
      headers: { origin }, data: { name: BRAND_NAME },
    });
    expect(partial.ok()).toBeTruthy();
    const saved = await merchantPage.request.get("/api/restaurant").then((response) => response.json());
    expect(saved).toMatchObject({
      name: BRAND_NAME,
      logo_url: LOGO_URL,
      primary_color: BRAND_COLOR,
      address: "12 rue de la République, 19200 Ussel",
      phone: "05 55 00 00 00",
      instagram: "@cafe_ussel",
      website: "https://example.com/cafe",
    });

    const joinPage = await merchantContext.newPage();
    try {
      await joinPage.goto(`/j/${slug}`);
      await expect(joinPage.locator(`img[src="${LOGO_URL}"]`)).toBeVisible();
    } finally {
      await joinPage.close();
    }
    await merchantPage.goto("/dashboard/poster");
    await expect(merchantPage.locator(`.poster img[src="${LOGO_URL}"]`)).toBeVisible();
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

  test("affiche à l'impression : chaque format garde ses dimensions physiques réelles (jamais étiré en 100vh)", async () => {
    // Régression : `@media print { .poster { width:auto; min-height:100vh } }`
    // écrasait les dimensions réelles des formats réduits — les boutons
    // changeaient l'aperçu écran sans rien garantir à l'impression. On ne
    // teste pas une vraie imprimante ici (impossible depuis ce test), mais
    // les dimensions CSS effectivement calculées sous `media: print`.
    //
    // `.no-print` passe à `display:none` sous `media: print` : les boutons de
    // contrôle deviennent alors inactionnables. On revient donc en media
    // "screen" pour cliquer, puis en "print" pour mesurer, à chaque étape.
    await merchantPage.goto("/dashboard/poster");

    const formats: { button: RegExp | string; expectClass: RegExp; widthMm: number; minHeightMm: number }[] = [
      { button: "A4 · vitrine / mur", expectClass: /poster--a4/, widthMm: 210, minHeightMm: 297 },
      { button: /A5/, expectClass: /poster--a5/, widthMm: 148, minHeightMm: 210 },
      { button: /Chevalet/, expectClass: /poster--chevalet/, widthMm: 105, minHeightMm: 148 },
    ];
    const viewportHeightPx = merchantPage.viewportSize()?.height ?? 0;

    for (const format of formats) {
      await merchantPage.emulateMedia({ media: "screen" });
      await merchantPage.getByRole("button", { name: format.button }).click();
      await expect(merchantPage.locator(".poster")).toHaveClass(format.expectClass);

      await merchantPage.emulateMedia({ media: "print" });
      const box = await merchantPage.locator(".poster").boundingBox();
      expect(box, `bounding box du format ${format.expectClass}`).not.toBeNull();
      expectMm(box!.width, format.widthMm, `largeur ${format.expectClass}`);
      // min-height : le contenu peut être plus grand, jamais plus petit —
      // et surtout jamais gonflé à 100vh comme avant le correctif.
      expect(box!.height, `hauteur ${format.expectClass}`).toBeGreaterThanOrEqual(format.minHeightMm * MM_TO_PX - SIZE_TOLERANCE_PX);
      if (format.minHeightMm < 290) {
        // Un format réduit ne doit pas se retrouver aussi haut qu'un plein écran.
        expect(box!.height, `${format.expectClass} ne doit pas être étiré à 100vh`).toBeLessThan(viewportHeightPx);
      }
      // Les contrôles ne doivent jamais apparaître sur le support imprimé.
      // (Pas de vérification de débordement horizontal ici : en media print,
      // le support fait la largeur réelle du papier — 210mm pour l'A4 par
      // exemple — qui dépasse volontairement un viewport mobile. Le
      // débordement n'a de sens qu'à l'écran, déjà couvert par
      // mobile-viewport.spec.ts et les autres tests de ce fichier.)
      await expect(merchantPage.locator(".no-print").first()).toBeHidden();
      await expect(merchantPage.locator(".poster img[alt*='QR code']")).toBeVisible();
    }

    // Les deux templates doivent rester lisibles et complets à l'impression.
    await merchantPage.emulateMedia({ media: "screen" });
    await merchantPage.getByRole("button", { name: "Contrasté" }).click();
    await merchantPage.emulateMedia({ media: "print" });
    await expect(merchantPage.locator(".poster")).toHaveClass(/poster--contrasted/);
    await expect(merchantPage.locator(".poster")).toHaveCSS("background-color", hexToRgb(BRAND_COLOR));
    await expect(merchantPage.locator(".poster")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(merchantPage.locator(".poster img[alt*='QR code']")).toBeVisible();

    await merchantPage.emulateMedia({ media: "screen" });
    await merchantPage.getByRole("button", { name: "Minimal" }).click();
    await merchantPage.emulateMedia({ media: "print" });
    await expect(merchantPage.locator(".poster")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(merchantPage.locator(".poster img[alt*='QR code']")).toBeVisible();

    await merchantPage.emulateMedia({ media: null });
    await merchantPage.getByRole("button", { name: "A4 · vitrine / mur" }).click();
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

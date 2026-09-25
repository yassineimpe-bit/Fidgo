import { expect, test } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";
import { createMerchant, enrollCustomer, origin, testClientIp, unique } from "./helpers";

const VISUAL_PATH = /^\/api\/card-images\/[0-9a-f-]{36}$/;

function jpeg(width: number, height: number, color = "#0f766e") {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

test("visuel de carte : import, fond image, bannière d'inscription, remplacement, retrait et refus", async ({ page, browser, playwright }) => {
  test.setTimeout(120_000);
  await createMerchant(page, "card-visual");
  const slug = String((await page.request.get("/api/restaurant").then((response) => response.json())).slug);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    // Import depuis les réglages : le fond « Visuel importé » est sélectionné.
    await page.goto("/dashboard/settings");
    await expect(page.getByRole("option", { name: "Visuel importé" })).toBeDisabled();
    await page.getByLabel("Importer un visuel").setInputFiles({ name: "vitrine.jpg", mimeType: "image/jpeg", buffer: await jpeg(1600, 1000) });
    await expect(page.getByText("Visuel importé.")).toBeVisible({ timeout: 15_000 });
    const current = page.getByRole("img", { name: "Visuel actuel de la carte" });
    const visualUrl = String(await current.getAttribute("src"));
    expect(visualUrl).toMatch(VISUAL_PATH);
    await expect(page.getByLabel("Fond de la carte")).toHaveValue("image");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText("Commerce enregistré.")).toBeVisible();
    expect(await page.request.get("/api/restaurant").then((response) => response.json())).toMatchObject({ card_background: "image" });

    // Fichier public ré-encodé, en-têtes stricts.
    const anonymous = await playwright.request.newContext({ baseURL: origin });
    const served = await anonymous.get(visualUrl);
    expect(served.status()).toBe(200);
    expect(served.headers()).toMatchObject({ "content-type": "image/webp", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
    expect(await sharp(await served.body()).metadata()).toMatchObject({ format: "webp", width: 1200, height: 600 });

    // Carte client : photo sous un voile sombre ; page d'inscription : bannière.
    await page.goto("/dashboard");
    const { cardUrl } = await enrollCustomer(page, "Visuel", `${unique("visual")}@example.com`);
    await page.goto(cardUrl);
    await expect(page.locator(".loyalty-card")).toHaveCSS("background-image", new RegExp(`url\\("${origin}${visualUrl}"\\)`));
    await expect(page.locator(".loyalty-card")).toHaveCSS("color", "rgb(255, 255, 255)");
    await page.goto(`/j/${slug}`);
    await expect(page.locator(`img.join-visual[src="${visualUrl}"]`)).toBeVisible();

    // Remplacement : l'ancien fichier disparaît.
    const replaced = await page.request.post("/api/restaurant/card-image", {
      headers: { origin }, multipart: { file: { name: "b.jpg", mimeType: "image/jpeg", buffer: await jpeg(800, 400, "#1d4ed8") } },
    });
    expect(replaced.status()).toBe(201);
    const nextUrl = String((await replaced.json()).cardImageUrl);
    expect(nextUrl).not.toBe(visualUrl);
    expect((await anonymous.get(visualUrl)).status()).toBe(404);
    const [{ stored }] = await sql`select count(*)::int as stored from establishment_card_images i join establishments e on e.id=i.establishment_id where e.slug=${slug}`;
    expect(stored).toBe(1);

    // Refus : SVG, trop petit, autre origine ; l'EMPLOYEE ne peut rien.
    const svg = await page.request.post("/api/restaurant/card-image", { headers: { origin }, multipart: { file: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') } } });
    expect(svg.status()).toBe(415);
    const small = await page.request.post("/api/restaurant/card-image", { headers: { origin }, multipart: { file: { name: "s.jpg", mimeType: "image/jpeg", buffer: await jpeg(400, 200) } } });
    expect(await small.json()).toEqual({ error: "IMAGE_TOO_SMALL" });
    expect((await page.request.post("/api/restaurant/card-image", { headers: { origin: "https://evil.example" }, multipart: { file: { name: "b.jpg", mimeType: "image/jpeg", buffer: await jpeg(800, 400) } } })).status()).toBe(403);
    const email = `${unique("visual-employee")}@example.com`;
    const password = "Password-test-123!";
    expect((await page.request.post("/api/employees", { headers: { origin }, data: { email, password, role: "EMPLOYEE" } })).ok()).toBeTruthy();
    const employeeContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    try {
      const employee = await employeeContext.newPage();
      expect((await employee.request.post(`${origin}/api/auth/login`, { headers: { origin }, data: { email, password } })).status()).toBe(200);
      expect((await employee.request.delete(`${origin}/api/restaurant/card-image`, { headers: { origin } })).status()).toBe(403);
    } finally {
      await employeeContext.close();
    }

    // Retrait : fond repassé en couleur unie, fichier supprimé.
    expect((await page.request.delete("/api/restaurant/card-image", { headers: { origin } })).ok()).toBeTruthy();
    expect(await page.request.get("/api/restaurant").then((response) => response.json())).toMatchObject({ card_background: "solid", card_image_id: null });
    expect((await anonymous.get(nextUrl)).status()).toBe(404);
    // Fond « image » sans visuel : couleur unie conservée.
    expect((await page.request.patch("/api/restaurant", { headers: { origin }, data: { cardBackground: "image" } })).ok()).toBeTruthy();
    expect(await page.request.get("/api/restaurant").then((response) => response.json())).toMatchObject({ card_background: "solid" });
    await anonymous.dispose();
  } finally {
    await sql.end({ timeout: 5 });
  }
});

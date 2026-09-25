import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp from "sharp";
import { createMerchant, origin, testClientIp, unique } from "./helpers";

const LOGO_PATH = /^\/api\/logos\/[0-9a-f-]{36}$/;

function png(width: number, height: number, color = "#b3261e") {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

function uploadLogo(page: Page, buffer: Buffer, fields: Record<string, string> = {}, name = "logo.png", mimeType = "image/png") {
  return page.request.post("/api/restaurant/logo", {
    headers: { origin },
    multipart: { file: { name, mimeType, buffer }, ...fields },
  });
}

async function establishmentState(sql: postgres.Sql, slug: string) {
  const [row] = await sql`
    select e.id, e.logo_url, count(l.id)::int as stored
    from establishments e left join establishment_logos l on l.establishment_id=e.id
    where e.slug=${slug} group by e.id
  `;
  return row;
}

async function currentSlug(page: Page) {
  return String((await page.request.get("/api/restaurant").then((response) => response.json())).slug);
}

test("import du logo : cadrage, zoom, conversion WebP, remplacement puis retrait", async ({ page, playwright }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "logo-upload");
  const slug = await currentSlug(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await page.goto("/dashboard/settings");
    await page.getByLabel("Importer un logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await png(900, 600) });
    const crop = page.getByRole("img", { name: /Cadrage du logo/ });
    await expect(crop).toBeVisible();
    await page.getByLabel("Zoom").fill("2");
    await crop.focus();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Enregistrer le logo" }).click();
    await expect(page.getByText("Logo importé.")).toBeVisible({ timeout: 15_000 });
    const logoUrl = await page.getByLabel("URL du logo").inputValue();
    expect(logoUrl).toMatch(LOGO_PATH);
    await expect(page.getByLabel("Aperçu de la carte fidélité").locator(`img[src="${logoUrl}"]`)).toBeVisible();

    // Le formulaire renvoie le chemin du logo importé : il reste accepté.
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText("Commerce enregistré.")).toBeVisible();
    expect(await establishmentState(sql, slug)).toMatchObject({ logo_url: logoUrl, stored: 1 });

    // Fichier servi publiquement, ré-encodé, avec des en-têtes stricts.
    const anonymous = await playwright.request.newContext({ baseURL: origin });
    const served = await anonymous.get(logoUrl);
    expect(served.status()).toBe(200);
    expect(served.headers()).toMatchObject({
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    expect(await sharp(await served.body()).metadata()).toMatchObject({ format: "webp", width: 512, height: 512 });

    const [audit] = await sql`
      select metadata from audit_logs a join establishments e on e.id=a.establishment_id
      where e.slug=${slug} and a.action='RESTAURANT_LOGO_UPLOADED'
    `;
    expect(audit.metadata).toMatchObject({ width: 512, height: 512, cropped: true });
    expect(Object.keys(audit.metadata).sort()).toEqual(["byteSize", "cropped", "height", "width"]);

    // Page publique d'inscription client : le logo importé est affiché.
    await page.goto(`/j/${slug}`);
    await expect(page.locator(`img[src="${logoUrl}"]`)).toBeVisible();

    // Remplacement : l'ancien fichier disparaît, son URL ne répond plus.
    const replaced = await uploadLogo(page, await png(400, 400, "#1d4ed8"));
    expect(replaced.status()).toBe(201);
    const nextUrl = String((await replaced.json()).logoUrl);
    expect(nextUrl).not.toBe(logoUrl);
    expect(await establishmentState(sql, slug)).toMatchObject({ logo_url: nextUrl, stored: 1 });
    expect((await anonymous.get(logoUrl)).status()).toBe(404);

    // Retrait depuis l'interface.
    await page.goto("/dashboard/settings");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Retirer le logo" }).click();
    await expect(page.getByText("Logo retiré.")).toBeVisible();
    await expect(page.getByLabel("URL du logo")).toHaveValue("");
    expect(await establishmentState(sql, slug)).toMatchObject({ logo_url: null, stored: 0 });
    expect((await anonymous.get(nextUrl)).status()).toBe(404);
    await anonymous.dispose();
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("import du logo : fichiers refusés, rôles, origine et isolation entre commerces", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await createMerchant(page, "logo-guard");
  const slug = await currentSlug(page);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="500" height="500"/></svg>');
    expect((await uploadLogo(page, svg, {}, "logo.png", "image/png")).status()).toBe(415);
    expect((await uploadLogo(page, Buffer.alloc(2 * 1024 * 1024 + 1, 1))).status()).toBe(413);
    expect((await uploadLogo(page, await png(100, 100))).status()).toBe(400);
    const outside = await uploadLogo(page, await png(300, 300), { cropX: "200", cropY: "0", cropSize: "200" });
    expect(outside.status()).toBe(400);
    expect(await outside.json()).toEqual({ error: "INVALID_CROP" });
    const crossOrigin = await page.request.post("/api/restaurant/logo", {
      headers: { origin: "https://evil.example" },
      multipart: { file: { name: "logo.png", mimeType: "image/png", buffer: await png(300, 300) } },
    });
    expect(crossOrigin.status()).toBe(403);
    expect(await establishmentState(sql, slug)).toMatchObject({ logo_url: null, stored: 0 });

    const accepted = await uploadLogo(page, await png(300, 300));
    expect(accepted.status()).toBe(201);
    const logoUrl = String((await accepted.json()).logoUrl);

    // EMPLOYEE : ni import ni retrait.
    const email = `${unique("logo-employee")}@example.com`;
    const password = "Password-test-123!";
    expect((await page.request.post("/api/employees", { headers: { origin }, data: { email, password, role: "EMPLOYEE" } })).ok()).toBeTruthy();
    const employeeContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    const employee = await employeeContext.newPage();
    try {
      const login = await employee.request.post(`${origin}/api/auth/login`, { headers: { origin }, data: { email, password } });
      expect(login.status()).toBe(200);
      expect((await employee.request.post(`${origin}/api/restaurant/logo`, {
        headers: { origin },
        multipart: { file: { name: "logo.png", mimeType: "image/png", buffer: await png(300, 300) } },
      })).status()).toBe(403);
      expect((await employee.request.delete(`${origin}/api/restaurant/logo`, { headers: { origin } })).status()).toBe(403);
    } finally {
      await employeeContext.close();
    }

    // Un autre commerce ne peut pas s'approprier ce logo par son chemin.
    const otherContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
    const other = await otherContext.newPage();
    try {
      await createMerchant(other, "logo-other");
      const stolen = await other.request.patch("/api/restaurant", { headers: { origin }, data: { logoUrl } });
      expect(stolen.status()).toBe(400);
      expect(await stolen.json()).toEqual({ error: "INVALID_FIELD", field: "logoUrl" });
    } finally {
      await otherContext.close();
    }

    // Passage à une URL externe : le fichier importé n'est plus conservé.
    const external = await page.request.patch("/api/restaurant", { headers: { origin }, data: { logoUrl: "https://example.com/logo.png" } });
    expect(external.ok()).toBeTruthy();
    expect(await establishmentState(sql, slug)).toMatchObject({ logo_url: "https://example.com/logo.png", stored: 0 });
    expect((await page.request.get(logoUrl)).status()).toBe(404);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, unique } from "./helpers";

// #196 / #197 : le solde d'une carte est dans l'unité du mode courant du
// programme (STAMPS → STAMP, POINTS → POINT), sans conversion. Ces tests
// vérifient qu'aucun chemin ne produit un état mélangeant les deux unités.

test.setTimeout(120_000);

type Sql = ReturnType<typeof postgres>;
type Mode = "STAMPS" | "POINTS";

function db() {
  return postgres(process.env.DATABASE_URL!, { max: 2, prepare: false });
}

function programPayload(mode: Mode, overrides: Record<string, unknown> = {}) {
  return {
    programName: "Carte test",
    mode,
    pointsRule: "PER_PURCHASE",
    rewardThreshold: 10,
    rewardLabel: "Café offert",
    cardMessage: null,
    stampsPerVisit: 1,
    pointsPerPurchase: 7,
    pointsPerEuro: 1,
    dailyEarnLimit: 0,
    cooldownSeconds: 0,
    expiresAfterDays: null,
    ...overrides,
  };
}

const patchProgram = (page: Page, mode: Mode, overrides: Record<string, unknown> = {}) =>
  page.request.patch("/api/program", { headers: { origin }, data: programPayload(mode, overrides) });

async function establishment(page: Page) {
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  return { id: String(restaurant.id), slug: String(restaurant.slug) };
}

async function enroll(page: Page, slug: string) {
  const response = await page.request.post("/api/enroll", {
    headers: { origin },
    data: { slug, firstName: "Unite", email: `${unique("unit")}@example.com`, marketingConsent: false },
  });
  expect(response.status()).toBe(201);
  return String((await response.json()).token);
}

async function credit(page: Page, token: string, key = crypto.randomUUID()) {
  return page.request.post("/api/credit", { headers: { origin }, data: { token, idempotencyKey: key } });
}

async function cardState(sql: Sql, token: string) {
  const [card] = await sql`select id, customer_id, balance from cards where token=${token}`;
  return { id: String(card.id), customerId: String(card.customer_id), balance: Number(card.balance) };
}

async function ledger(sql: Sql, establishmentId: string) {
  return sql`select id, type, delta, unit, balance_after from transactions where establishment_id=${establishmentId} order by created_at, id`
    .then((rows) => rows.map((row) => ({ ...row })));
}

async function programMode(sql: Sql, establishmentId: string) {
  const [program] = await sql`select mode from loyalty_programs where establishment_id=${establishmentId}`;
  return String(program.mode) as Mode;
}

/** Aucune écriture dans une autre unité que celle du mode courant. */
async function expectSingleUnit(sql: Sql, establishmentId: string) {
  const mode = await programMode(sql, establishmentId);
  const expected = mode === "STAMPS" ? "STAMP" : "POINT";
  const [mixed] = await sql`select count(*)::int as count from transactions where establishment_id=${establishmentId} and unit <> ${expected}`;
  expect(mixed.count, `écritures hors unité ${expected}`).toBe(0);
}

async function adjust(page: Page, customerId: string, newBalance: number) {
  const response = await page.request.post(`/api/customers/${customerId}/adjust`, {
    headers: { origin },
    data: { newBalance, reason: "Remise à zéro de test", idempotencyKey: crypto.randomUUID() },
  });
  expect(response.ok()).toBeTruthy();
}

async function reverse(page: Page, transactionId: string, key = crypto.randomUUID()) {
  return page.request.post("/api/transactions/reverse", { headers: { origin }, data: { transactionId, idempotencyKey: key } });
}

test("programme : le mode ne change que tant que le programme n'a jamais servi", async ({ page }) => {
  const sql = db();
  try {
    // 1. Programme vierge (aucune carte) : STAMPS → POINTS → STAMPS.
    await createMerchant(page, "unit-blank");
    const blank = await establishment(page);
    expect((await patchProgram(page, "POINTS")).status()).toBe(200);
    expect((await patchProgram(page, "STAMPS")).status()).toBe(200);

    // 2. Une carte à 0 sans aucune écriture : toujours autorisé.
    const token = await enroll(page, blank.slug);
    expect((await patchProgram(page, "POINTS")).status()).toBe(200);
    expect((await patchProgram(page, "STAMPS")).status()).toBe(200);

    // 3. Solde > 0 : 409, rien ne change (programme, solde, ledger, audit).
    expect((await credit(page, token)).ok()).toBeTruthy();
    const before = { card: await cardState(sql, token), ledger: await ledger(sql, blank.id) };
    const [auditsBefore] = await sql`select count(*)::int as count from audit_logs where establishment_id=${blank.id} and action='PROGRAM_UPDATE'`;
    const locked = await patchProgram(page, "POINTS", { rewardLabel: "Ne doit pas être enregistré" });
    expect(locked.status()).toBe(409);
    expect(await locked.json()).toMatchObject({ error: "PROGRAM_MODE_LOCKED", hasBalance: true, hasHistory: true });
    expect(await programMode(sql, blank.id)).toBe("STAMPS");
    const [program] = await sql`select reward_label from loyalty_programs where establishment_id=${blank.id}`;
    expect(program.reward_label).toBe("Café offert");
    expect(await cardState(sql, token)).toEqual(before.card);
    expect(await ledger(sql, blank.id)).toEqual(before.ledger);
    const [auditsAfter] = await sql`select count(*)::int as count from audit_logs where establishment_id=${blank.id} and action='PROGRAM_UPDATE'`;
    expect(auditsAfter.count).toBe(auditsBefore.count);

    // 6. Mode inchangé : les autres réglages restent modifiables.
    const edited = await patchProgram(page, "STAMPS", { rewardLabel: "Croissant offert", rewardThreshold: 8, stampsPerVisit: 2 });
    expect(edited.status()).toBe(200);
    expect(await edited.json()).toMatchObject({ mode: "STAMPS", reward_label: "Croissant offert", reward_threshold: 8, stamps_per_visit: 2 });

    // 4. Historique STAMP, solde remis à 0 : toujours 409 (historique seul).
    await adjust(page, before.card.customerId, 0);
    expect((await cardState(sql, token)).balance).toBe(0);
    const historyOnly = await patchProgram(page, "POINTS");
    expect(historyOnly.status()).toBe(409);
    expect(await historyOnly.json()).toMatchObject({ error: "PROGRAM_MODE_LOCKED", hasBalance: false, hasHistory: true });
    expect(await programMode(sql, blank.id)).toBe("STAMPS");
    await expectSingleUnit(sql, blank.id);

    // 5. Historique POINT puis tentative STAMPS : 409 ; en POINTS, la règle de points reste modifiable.
    await createMerchant(page, "unit-points");
    const points = await establishment(page);
    expect((await patchProgram(page, "POINTS")).status()).toBe(200);
    const pointsToken = await enroll(page, points.slug);
    const earned = await credit(page, pointsToken);
    expect(await earned.json()).toMatchObject({ mode: "POINTS", delta: 7, balance: 7 });
    await adjust(page, (await cardState(sql, pointsToken)).customerId, 0);
    const toStamps = await patchProgram(page, "STAMPS");
    expect(toStamps.status()).toBe(409);
    expect(await toStamps.json()).toMatchObject({ error: "PROGRAM_MODE_LOCKED", hasBalance: false, hasHistory: true });
    const rule = await patchProgram(page, "POINTS", { pointsRule: "PER_EURO", pointsPerEuro: 2 });
    expect(rule.status()).toBe(200);
    expect(await rule.json()).toMatchObject({ mode: "POINTS", points_rule: "PER_EURO" });
    await expectSingleUnit(sql, points.id);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("programme : changement de mode et crédit/redeem simultanés restent sérialisés", async ({ page }) => {
  const sql = db();
  try {
    await createMerchant(page, "unit-race");
    const merchant = await establishment(page);
    const token = await enroll(page, merchant.slug);

    // a. Un PATCH qui tient la ligne programme (FOR UPDATE) bloque le crédit ;
    //    le crédit lit ensuite le mode validé et écrit dans la bonne unité.
    const patchLock = sql.reserve();
    const holder = await patchLock;
    await holder`begin`;
    await holder`select id from loyalty_programs where establishment_id=${merchant.id} for update`;
    let creditDone = false;
    const pendingCredit = credit(page, token).then((response) => { creditDone = true; return response; });
    await page.waitForTimeout(1_500);
    expect(creditDone, "le crédit doit attendre le verrou programme").toBe(false);
    await holder`update loyalty_programs set mode='POINTS' where establishment_id=${merchant.id}`;
    await holder`commit`;
    holder.release();
    const afterSwitch = await pendingCredit;
    expect(await afterSwitch.json()).toMatchObject({ mode: "POINTS" });
    await expectSingleUnit(sql, merchant.id);

    // b. Un crédit en cours (carte FOR UPDATE + programme FOR SHARE) bloque le
    //    PATCH, qui voit ensuite le solde validé et refuse le changement.
    await createMerchant(page, "unit-race-b");
    const other = await establishment(page);
    const otherToken = await enroll(page, other.slug);
    const creditLock = await sql.reserve();
    await creditLock`begin`;
    const [locked] = await creditLock`
      select c.id from cards c join loyalty_programs p on p.establishment_id=c.establishment_id
      where c.token=${otherToken} for update of c for share of p
    `;
    await creditLock`
      insert into transactions(establishment_id,card_id,type,delta,balance_after,unit,idempotency_key)
      values(${other.id},${locked.id},'earn',1,1,'STAMP',${crypto.randomUUID()})
    `;
    await creditLock`update cards set balance=1 where id=${locked.id}`;
    let patchDone = false;
    const pendingPatch = patchProgram(page, "POINTS").then((response) => { patchDone = true; return response; });
    await page.waitForTimeout(1_500);
    expect(patchDone, "le PATCH doit attendre la fin du crédit").toBe(false);
    await creditLock`commit`;
    creditLock.release();
    expect((await pendingPatch).status()).toBe(409);
    expect(await programMode(sql, other.id)).toBe("STAMPS");
    await expectSingleUnit(sql, other.id);

    // c. Requêtes réelles en parallèle, sur un programme vierge : quel que soit
    //    l'ordre, le résultat est cohérent (crédit STAMP + 409, ou bascule + crédit POINT).
    for (let round = 0; round < 3; round += 1) {
      await createMerchant(page, `unit-race-c${round}`);
      const fresh = await establishment(page);
      const freshToken = await enroll(page, fresh.slug);
      const [patched, credited] = await Promise.all([patchProgram(page, "POINTS"), credit(page, freshToken)]);
      expect(credited.ok()).toBeTruthy();
      const mode = await programMode(sql, fresh.id);
      expect(patched.status()).toBe(mode === "POINTS" ? 200 : 409);
      await expectSingleUnit(sql, fresh.id);
    }

    // d. Redeem pendant un PATCH : le redeem attend le verrou programme, puis
    //    le PATCH, refusé (solde ou historique), ne bascule rien.
    await createMerchant(page, "unit-race-d");
    const redeemer = await establishment(page);
    expect((await patchProgram(page, "STAMPS", { rewardThreshold: 2 })).status()).toBe(200);
    const redeemToken = await enroll(page, redeemer.slug);
    expect((await credit(page, redeemToken)).ok()).toBeTruthy();
    expect((await credit(page, redeemToken)).ok()).toBeTruthy();
    const lock = await sql.reserve();
    await lock`begin`;
    await lock`select id from loyalty_programs where establishment_id=${redeemer.id} for update`;
    let redeemDone = false;
    const pendingRedeem = page.request.post("/api/redeem", { headers: { origin }, data: { token: redeemToken, idempotencyKey: crypto.randomUUID() } })
      .then((response) => { redeemDone = true; return response; });
    await page.waitForTimeout(1_500);
    expect(redeemDone, "le redeem doit attendre le verrou programme").toBe(false);
    await lock`rollback`;
    lock.release();
    expect((await pendingRedeem).ok()).toBeTruthy();
    const [patchAfterRedeem] = await Promise.all([
      patchProgram(page, "POINTS"),
      page.request.post("/api/redeem", { headers: { origin }, data: { token: redeemToken, idempotencyKey: crypto.randomUUID() } }),
    ]);
    expect(patchAfterRedeem.status()).toBe(409);
    expect(await programMode(sql, redeemer.id)).toBe("STAMPS");
    await expectSingleUnit(sql, redeemer.id);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("reversal : refusée sans mutation quand l'unité historique ne correspond plus au programme", async ({ page }) => {
  const sql = db();
  try {
    await createMerchant(page, "unit-reverse");
    const merchant = await establishment(page);
    // Délai anti double-crédit à 0 : plusieurs crédits successifs sur une carte.
    expect((await patchProgram(page, "STAMPS")).status()).toBe(200);
    const token = await enroll(page, merchant.slug);
    const key = crypto.randomUUID();
    expect((await credit(page, token, key)).ok()).toBeTruthy();
    expect((await credit(page, token)).ok()).toBeTruthy();
    const txId = async (idempotencyKey: string) => {
      const [row] = await sql`select id from transactions where establishment_id=${merchant.id} and idempotency_key=${idempotencyKey}`;
      return String(row.id);
    };
    const firstEarn = await txId(key);

    // 1. STAMP sous STAMPS : succès, idempotent, et pas de double annulation.
    const reverseKey = crypto.randomUUID();
    const reversed = await reverse(page, firstEarn, reverseKey);
    expect(reversed.status()).toBe(200);
    expect(await reversed.json()).toMatchObject({ balance: 1, duplicate: false });
    const replay = await reverse(page, firstEarn, reverseKey);
    expect(await replay.json()).toMatchObject({ balance: 1, duplicate: true });
    const twice = await reverse(page, firstEarn);
    expect(twice.status()).toBe(409);
    expect(await twice.json()).toMatchObject({ error: "ALREADY_REVERSED" });

    // 3. Données historiques incohérentes (migration, import, ou état antérieur
    //    à #196) : programme passé en POINTS hors API avec des écritures STAMP.
    const [secondEarn] = await sql`select id from transactions where establishment_id=${merchant.id} and type='earn' and reversed_transaction_id is null and id <> ${firstEarn}`;
    await sql`update loyalty_programs set mode='POINTS' where establishment_id=${merchant.id}`;
    const before = { card: await cardState(sql, token), ledger: await ledger(sql, merchant.id) };
    const mismatchKey = crypto.randomUUID();
    const refused = await reverse(page, String(secondEarn.id), mismatchKey);
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "UNIT_MISMATCH" });
    // 5–6. Solde et ledger inchangés ; la même clé rejouée reste refusée.
    expect(await cardState(sql, token)).toEqual(before.card);
    expect(await ledger(sql, merchant.id)).toEqual(before.ledger);
    expect((await reverse(page, String(secondEarn.id), mismatchKey)).status()).toBe(409);
    expect(await ledger(sql, merchant.id)).toEqual(before.ledger);

    // 2. POINT sous POINTS : succès.
    await createMerchant(page, "unit-reverse-points");
    const points = await establishment(page);
    expect((await patchProgram(page, "POINTS")).status()).toBe(200);
    const pointsToken = await enroll(page, points.slug);
    const pointsKey = crypto.randomUUID();
    expect((await credit(page, pointsToken, pointsKey)).ok()).toBeTruthy();
    expect((await credit(page, pointsToken)).ok()).toBeTruthy();
    const [pointsEarn] = await sql`select id from transactions where establishment_id=${points.id} and idempotency_key=${pointsKey}`;
    const pointsReversed = await reverse(page, String(pointsEarn.id));
    expect(pointsReversed.status()).toBe(200);
    expect(await pointsReversed.json()).toMatchObject({ balance: 7 });

    // 4. POINT sous STAMPS (programme modifié hors API) : refus sans mutation.
    const [otherPoint] = await sql`select id from transactions where establishment_id=${points.id} and type='earn' and id <> ${pointsEarn.id}`;
    await sql`update loyalty_programs set mode='STAMPS' where establishment_id=${points.id}`;
    const pointsBefore = { card: await cardState(sql, pointsToken), ledger: await ledger(sql, points.id) };
    const pointRefused = await reverse(page, String(otherPoint.id));
    expect(pointRefused.status()).toBe(409);
    expect(await pointRefused.json()).toMatchObject({ error: "UNIT_MISMATCH" });
    expect(await cardState(sql, pointsToken)).toEqual(pointsBefore.card);
    expect(await ledger(sql, points.id)).toEqual(pointsBefore.ledger);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("reversal : comportement documenté sur carte inactive, expirée ou client effacé (inchangé)", async ({ page }) => {
  const sql = db();
  try {
    await createMerchant(page, "unit-lifecycle");
    const merchant = await establishment(page);
    expect((await patchProgram(page, "STAMPS")).status()).toBe(200);
    const cases = [] as { token: string; earnId: string }[];
    for (let index = 0; index < 3; index += 1) {
      const token = await enroll(page, merchant.slug);
      const key = crypto.randomUUID();
      expect((await credit(page, token, key)).ok()).toBeTruthy();
      expect((await credit(page, token)).ok()).toBeTruthy();
      const [row] = await sql`select id from transactions where establishment_id=${merchant.id} and idempotency_key=${key}`;
      cases.push({ token, earnId: String(row.id) });
    }
    const [inactive, expired, erased] = cases;
    await sql`update cards set active=false where token=${inactive.token}`;
    await sql`update cards set expires_at=now() - interval '1 day' where token=${expired.token}`;
    const erasedCard = await cardState(sql, erased.token);
    await sql`
      update customers set email=null, phone=null, first_name=null, internal_note=null,
        marketing_consent=false, marketing_consent_at=null, deleted_at=now()
      where id=${erasedCard.customerId}
    `;
    await sql`update cards set active=false where token=${erased.token}`;

    // Politique actuelle conservée : une correction du ledger reste possible
    // sur ces cartes (le solde est conservé), tant que l'unité correspond.
    for (const item of [inactive, expired, erased]) {
      const response = await reverse(page, item.earnId);
      expect(response.status(), item.token).toBe(200);
      expect(await response.json()).toMatchObject({ balance: 1 });
    }
    await expectSingleUnit(sql, merchant.id);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

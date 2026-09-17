import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createMerchant, origin, unique } from "./helpers";

function assertDedicatedTestDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL_REQUIRED_FOR_PILOT_RUSH");
  const target = new URL(raw);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
  const local = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(target.hostname);
  if (!local || !/test/i.test(databaseName)) {
    throw new Error("PILOT_RUSH_REQUIRES_LOCAL_TEST_DATABASE");
  }
}

test("rush automatisé : 30 scans/crédits isolés conservent un ledger exact", async ({ page }) => {
  test.setTimeout(120_000);
  assertDedicatedTestDatabase();
  await createMerchant(page, "pilot-rush");

  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  const program = await page.request.get("/api/program").then((response) => response.json());
  const programUpdate = await page.request.patch("/api/program", {
    headers: { origin },
    data: {
      programName: program.program_name,
      mode: "STAMPS",
      pointsRule: "PER_PURCHASE",
      rewardThreshold: 100,
      rewardLabel: program.reward_label,
      cardMessage: program.card_message,
      stampsPerVisit: 1,
      pointsPerPurchase: 10,
      pointsPerEuro: 1,
      dailyEarnLimit: 0,
      cooldownSeconds: 0,
      expiresAfterDays: null,
    },
  });
  expect(programUpdate.ok()).toBeTruthy();

  const enrollment = await page.request.post("/api/enroll", {
    headers: { origin },
    data: {
      slug: restaurant.slug,
      firstName: "Rush test",
      email: `${unique("rush-card")}@example.com`,
      marketingConsent: false,
    },
  });
  expect(enrollment.status()).toBe(201);
  const { token } = await enrollment.json();

  for (let operation = 1; operation <= 30; operation += 1) {
    const scan = await page.request.post("/api/scan", {
      headers: { origin },
      data: { token },
    });
    expect(scan.ok(), `scan ${operation}`).toBeTruthy();
    expect((await scan.json()).balance).toBe(operation - 1);

    const credit = await page.request.post("/api/credit", {
      headers: { origin },
      data: { token, idempotencyKey: crypto.randomUUID() },
    });
    expect(credit.ok(), `credit ${operation}`).toBeTruthy();
    await expect(credit.json()).resolves.toMatchObject({ balance: operation, duplicate: false });
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [state] = await sql`
      select c.balance,
        count(t.id) filter (where t.type='earn')::int as earn_count,
        coalesce(sum(t.delta),0)::int as ledger_balance
      from cards c left join transactions t on t.card_id=c.id
      where c.token=${token}
      group by c.id,c.balance
    `;
    expect(Number(state.balance)).toBe(30);
    expect(Number(state.earn_count)).toBe(30);
    expect(Number(state.ledger_balance)).toBe(30);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

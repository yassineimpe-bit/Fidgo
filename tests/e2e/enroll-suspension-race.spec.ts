import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { hashRateKey } from "../../lib/security";
import { createMerchant, origin, testClientIp, unique } from "./helpers";

test.setTimeout(180_000);

const ENROLL_PAUSE_LOCK = 180_180;

function db() {
  return postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
}

async function merchantInfo(page: Page) {
  const restaurant = await page.request.get("/api/restaurant").then((response) => response.json());
  const employees = await page.request.get("/api/employees").then((response) => response.json());
  const owner = employees.find((employee: { role: string }) => employee.role === "OWNER");
  expect(owner).toBeTruthy();
  return {
    id: String(restaurant.id),
    slug: String(restaurant.slug),
    ownerId: String(owner.id),
  };
}

async function waitForBlockedQuery(sql: ReturnType<typeof postgres>, fragment: string) {
  await expect.poll(async () => {
    const [row] = await sql`
      select count(*)::int as count
      from pg_stat_activity
      where pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
        and query ilike ${`%${fragment}%`}
    `;
    return Number(row.count);
  }, { timeout: 15_000 }).toBeGreaterThan(0);
}

async function holdEnrollmentRateLimit(keyHash: string) {
  const blocker = db();
  let releaseSignal!: () => void;
  let readySignal!: () => void;
  const released = new Promise<void>((resolve) => { releaseSignal = resolve; });
  const ready = new Promise<void>((resolve) => { readySignal = resolve; });
  const done = blocker.begin(async (tx) => {
    await tx`
      insert into rate_limits(key_hash, hits, window_started_at)
      values(${keyHash}, 0, now())
      on conflict(key_hash) do update set hits=rate_limits.hits
    `;
    await tx`select key_hash from rate_limits where key_hash=${keyHash} for update`;
    readySignal();
    await released;
  });
  await ready;
  let releasedOnce = false;
  return async () => {
    if (releasedOnce) return;
    releasedOnce = true;
    releaseSignal();
    await done;
    await blocker.end({ timeout: 5 });
  };
}

async function enroll(page: Page, slug: string, email: string, ip: string) {
  return page.request.post("/api/enroll", {
    headers: { origin, "x-real-ip": ip },
    data: { slug, firstName: "Course", email },
  });
}

test("enroll : une suspension propriétaire qui gagne empêche toute création", async ({ page }) => {
  await createMerchant(page, "enroll-owner-suspend");
  const merchant = await merchantInfo(page);
  const sql = db();
  const ip = testClientIp();
  const email = `${unique("owner-suspend-race")}@example.com`;
  let release = await holdEnrollmentRateLimit(hashRateKey(`enroll:${ip}:${merchant.id}`));
  try {
    const enrollment = enroll(page, merchant.slug, email, ip);
    await waitForBlockedQuery(sql, "insert into rate_limits");

    const suspended = await page.request.post("/api/restaurant/suspend", {
      headers: { origin },
      data: { confirmation: "SUSPENDRE", confirmationSlug: merchant.slug },
    });
    expect(suspended.status()).toBe(200);

    await release();
    release = async () => undefined;
    expect((await enrollment).status()).toBe(404);
    const [state] = await sql`
      select
        (select count(*)::int from customers where establishment_id=${merchant.id} and email=${email}) as customers,
        (select count(*)::int from cards where establishment_id=${merchant.id} and active) as active_cards
    `;
    expect(state).toMatchObject({ customers: 0, active_cards: 0 });
  } finally {
    await release();
    await sql.end({ timeout: 5 });
  }
});

test("enroll : suspension plateforme puis réactivation ne fait pas apparaître de carte", async ({ page, browser }) => {
  await createMerchant(page, "enroll-platform-admin");
  const admin = await merchantInfo(page);
  const targetContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": testClientIp() } });
  const targetPage = await targetContext.newPage();
  const sql = db();
  let release: () => Promise<void> = async () => undefined;
  try {
    await createMerchant(targetPage, "enroll-platform-target");
    const target = await merchantInfo(targetPage);
    await sql`insert into platform_admins(staff_user_id, note) values(${admin.ownerId}, 'e2e enroll race')`;

    const ip = testClientIp();
    const email = `${unique("platform-suspend-race")}@example.com`;
    release = await holdEnrollmentRateLimit(hashRateKey(`enroll:${ip}:${target.id}`));
    const enrollment = enroll(targetPage, target.slug, email, ip);
    await waitForBlockedQuery(sql, "insert into rate_limits");

    const suspended = await page.request.post(`/api/admin/establishments/${target.id}/suspension`, {
      headers: { origin },
      data: { action: "suspend", reason: "Course déterministe enrollment", confirmationSlug: target.slug },
    });
    expect(suspended.status()).toBe(200);

    await release();
    release = async () => undefined;
    expect((await enrollment).status()).toBe(404);

    const reactivated = await page.request.post(`/api/admin/establishments/${target.id}/suspension`, {
      headers: { origin },
      data: { action: "reactivate", reason: "Vérification après la course", confirmationSlug: target.slug },
    });
    expect(reactivated.status()).toBe(200);
    const [state] = await sql`
      select
        (select count(*)::int from customers where establishment_id=${target.id} and email=${email}) as customers,
        (select count(*)::int from cards where establishment_id=${target.id}) as cards
    `;
    expect(state).toMatchObject({ customers: 0, cards: 0 });
  } finally {
    await release();
    await sql`delete from platform_admins where staff_user_id=${admin.ownerId}`;
    await sql.end({ timeout: 5 });
    await targetContext.close();
  }
});

test("enroll : s'il gagne le verrou, la suspension propriétaire traite la nouvelle carte", async ({ page }) => {
  await createMerchant(page, "enroll-wins");
  const merchant = await merchantInfo(page);
  const sql = db();
  const blocker = db();
  const observer = db();
  const email = `enroll-wins-${unique("customer")}@example.com`;
  let advisoryHeld = false;
  try {
    await sql.unsafe(`
      create or replace function test_pause_enroll_customer()
      returns trigger language plpgsql as $pause$
      begin
        if new.email like 'enroll-wins-%@example.com' then
          perform pg_advisory_xact_lock(${ENROLL_PAUSE_LOCK});
        end if;
        return new;
      end
      $pause$
    `);
    await sql.unsafe("drop trigger if exists test_pause_enroll_customer on customers");
    await sql.unsafe(`
      create trigger test_pause_enroll_customer
      before insert on customers
      for each row execute function test_pause_enroll_customer()
    `);
    await blocker`select pg_advisory_lock(${ENROLL_PAUSE_LOCK})`;
    advisoryHeld = true;

    const enrollment = enroll(page, merchant.slug, email, testClientIp());
    await expect.poll(async () => {
      const [row] = await observer`
        select count(*)::int as count from pg_locks
        where locktype='advisory' and objid=${ENROLL_PAUSE_LOCK} and not granted
      `;
      return Number(row.count);
    }, { timeout: 15_000 }).toBeGreaterThan(0);

    const suspension = page.request.post("/api/restaurant/suspend", {
      headers: { origin },
      data: { confirmation: "SUSPENDRE", confirmationSlug: merchant.slug },
    });
    await waitForBlockedQuery(observer, "from establishments");

    await blocker`select pg_advisory_unlock(${ENROLL_PAUSE_LOCK})`;
    advisoryHeld = false;
    expect((await enrollment).status()).toBe(201);
    expect((await suspension).status()).toBe(200);

    const [state] = await sql`
      select e.status, count(c.id)::int as cards,
        count(c.id) filter (where c.active)::int as active_cards
      from establishments e
      left join customers u on u.establishment_id=e.id and u.email=${email}
      left join cards c on c.customer_id=u.id
      where e.id=${merchant.id}
      group by e.status
    `;
    expect(state).toMatchObject({ status: "suspended", cards: 1, active_cards: 0 });
  } finally {
    if (advisoryHeld) await blocker`select pg_advisory_unlock(${ENROLL_PAUSE_LOCK})`;
    await sql.unsafe("drop trigger if exists test_pause_enroll_customer on customers");
    await sql.unsafe("drop function if exists test_pause_enroll_customer() ");
    await Promise.all([sql.end({ timeout: 5 }), blocker.end({ timeout: 5 }), observer.end({ timeout: 5 })]);
  }
});

test("enroll : programme désactivé et doublon concurrent restent refusés", async ({ page }) => {
  await createMerchant(page, "enroll-program-duplicate");
  const merchant = await merchantInfo(page);
  const sql = db();
  let release: () => Promise<void> = async () => undefined;
  try {
    const ip = testClientIp();
    const disabledEmail = `${unique("program-disabled")}@example.com`;
    release = await holdEnrollmentRateLimit(hashRateKey(`enroll:${ip}:${merchant.id}`));
    const disabledEnrollment = enroll(page, merchant.slug, disabledEmail, ip);
    await waitForBlockedQuery(sql, "insert into rate_limits");
    await sql`update loyalty_programs set active=false where establishment_id=${merchant.id}`;
    await release();
    release = async () => undefined;
    expect((await disabledEnrollment).status()).toBe(404);
    expect((await sql`select id from customers where establishment_id=${merchant.id} and email=${disabledEmail}`)).toHaveLength(0);

    await sql`update loyalty_programs set active=true where establishment_id=${merchant.id}`;
    const duplicateEmail = `${unique("duplicate-enroll")}@example.com`;
    const responses = await Promise.all([
      enroll(page, merchant.slug, duplicateEmail, testClientIp()),
      enroll(page, merchant.slug, duplicateEmail, testClientIp()),
    ]);
    expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
    const [counts] = await sql`
      select count(distinct u.id)::int as customers, count(c.id)::int as cards
      from customers u left join cards c on c.customer_id=u.id
      where u.establishment_id=${merchant.id} and u.email=${duplicateEmail}
    `;
    expect(counts).toMatchObject({ customers: 1, cards: 1 });
  } finally {
    await release();
    await sql.end({ timeout: 5 });
  }
});

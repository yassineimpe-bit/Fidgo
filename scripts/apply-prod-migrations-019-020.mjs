import fs from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const db = postgres(databaseUrl, { max: 1, prepare: false });

try {
  for (const file of [
    "db/migrations/019_platform_super_admin.sql",
    "db/migrations/020_merchant_onboarding.sql",
  ]) {
    const sqlText = await fs.readFile(file, "utf8");
    console.log(`Applying ${file}`);
    await db.unsafe(sqlText);
  }

  const [state] = await db.unsafe(`
    select
      to_regclass('public.platform_admins') is not null as platform_admins,
      to_regclass('public.platform_admin_audit') is not null as platform_admin_audit,
      exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='establishments'
          and column_name='platform_suspended_at'
      ) as platform_suspended_at,
      exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='establishments'
          and column_name='onboarding_step'
      ) as onboarding_step,
      exists (
        select 1 from pg_constraint
        where conname='establishments_platform_suspension_check'
      ) as platform_suspension_check,
      exists (
        select 1 from pg_constraint
        where conname='establishments_onboarding_step_check'
      ) as onboarding_step_check,
      exists (
        select 1 from pg_trigger
        where tgname='platform_admin_audit_append_only' and not tgisinternal
      ) as platform_admin_audit_append_only
  `);

  console.log("Migration verification:", state);

  if (!Object.values(state).every(Boolean)) {
    throw new Error("Migration verification failed");
  }
} finally {
  await db.end({ timeout: 5 });
}

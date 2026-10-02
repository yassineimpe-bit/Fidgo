import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

// La purge est globale par nature : elle tourne ici dans une base temporaire
// dédiée, jamais dans la base partagée par les autres specs.
const script = path.join(process.cwd(), "scripts", "purge-data-lifecycle.mjs");
const setup = path.join(process.cwd(), "scripts", "db-setup.mjs");

function databaseUrl(name: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

function runPurge(url: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
}

test("purge data lifecycle : rétention respectée, idempotente, verrouillée et sans donnée personnelle", async () => {
  test.setTimeout(120_000);
  const name = `purge_e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const url = databaseUrl(name);
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const migrated = spawnSync(process.execPath, [setup], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    expect(migrated.status, migrated.stderr).toBe(0);

    // Aucune donnée : dry-run et exécution réussissent sans rien supprimer.
    const empty = runPurge(url, "--execute");
    expect(empty.status, empty.stderr).toBe(0);
    expect(Object.values(JSON.parse(empty.stdout).deleted)).toEqual([0, 0, 0, 0, 0, 0, 0]);

    const [establishment] = await sql`insert into establishments(slug,name) values('purge-e2e','Purge E2E') returning id`;
    const [staff] = await sql`insert into staff_users(establishment_id,email,password_hash) values(${establishment.id},'owner-purge@example.test','$2a$12$abcdefghijklmnopqrstuuJ1d3m1o2ZQ0n9xYQ0n9xYQ0n9xYQ0n9xY') returning id`;
    const [customer] = await sql`insert into customers(establishment_id,first_name,email) values(${establishment.id},'Camille','camille-purge@example.test') returning id`;
    const [card] = await sql`insert into cards(establishment_id,customer_id,token,short_code) values(${establishment.id},${customer.id},${`LOY1:${"P".repeat(43)}`},'PRG234') returning id`;

    // Pour chaque table : une ligne au-delà de la rétention, une ligne à garder.
    await sql`insert into product_events(establishment_id,event_type,created_at) values
      (${establishment.id},'SCAN_SUCCESS',now()-interval '181 days'),
      (${establishment.id},'SCAN_SUCCESS',now()-interval '179 days')`;
    await sql`insert into audit_logs(establishment_id,action,created_at) values
      (${establishment.id},'OLD',now()-interval '731 days'),
      (${establishment.id},'KEEP',now()-interval '729 days')`;
    await sql`insert into card_recovery_tokens(establishment_id,card_id,token_hash,expires_at,used_at) values
      (${establishment.id},${card.id},${"a".repeat(64)},now()-interval '31 days',now()-interval '31 days'),
      (${establishment.id},${card.id},${"b".repeat(64)},now()+interval '1 hour',null)`;
    await sql`insert into password_reset_tokens(staff_user_id,token_hash,expires_at) values
      (${staff.id},${"c".repeat(64)},now()-interval '31 days'),
      (${staff.id},${"d".repeat(64)},now()-interval '29 days')`;
    await sql`insert into email_verification_tokens(staff_user_id,token_hash,expires_at,used_at) values
      (${staff.id},${"e".repeat(64)},now()-interval '31 days',now()-interval '31 days'),
      (${staff.id},${"f".repeat(64)},now()+interval '1 day',now()-interval '29 days')`;
    const [revoked] = await sql`insert into wallet_passes(establishment_id,card_id,provider,serial_number,status,updated_at) values(${establishment.id},${card.id},'APPLE','purge-revoked','revoked',now()-interval '31 days') returning id`;
    await sql`insert into apple_wallet_registrations(wallet_pass_id,device_library_identifier,push_token) values(${revoked.id},'device-purge','push-purge')`;
    await sql`insert into rate_limits(key_hash,hits,window_started_at) values(${"1".repeat(64)},1,now()-interval '3 days'),(${"2".repeat(64)},1,now()-interval '1 day')`;
    await sql`insert into transactions(establishment_id,card_id,staff_user_id,type,delta,balance_after,unit,idempotency_key,created_at)
      values(${establishment.id},${card.id},${staff.id},'adjust',2,2,'STAMP',${`purge-e2e-${Date.now()}`},now()-interval '900 days')`;
    await sql`update cards set balance=2 where id=${card.id}`;

    const expectedEligible = { product_events: 1, audit_logs: 1, recovery_tokens: 1, password_reset_tokens: 1, email_verification_tokens: 1, apple_registrations: 1, rate_limits: 1 };
    const dryRun = runPurge(url);
    expect(dryRun.status, dryRun.stderr).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({ mode: "dry-run", eligible: expectedEligible });
    // Le dry-run ne supprime rien.
    const [beforeExecute] = await sql`select (select count(*)::int from product_events) as events, (select count(*)::int from rate_limits) as limits`;
    expect(beforeExecute).toEqual({ events: 2, limits: 2 });

    // Un autre processus détient le verrou : refus, aucune suppression.
    const holder = postgres(url, { max: 1, prepare: false });
    try {
      await holder`select pg_advisory_lock(hashtext('retiko-data-lifecycle'))`;
      const concurrent = runPurge(url, "--execute");
      expect(concurrent.status).not.toBe(0);
      expect(concurrent.stderr).toContain("déjà en cours");
    } finally {
      await holder.end({ timeout: 5 });
    }
    const [stillThere] = await sql`select count(*)::int as n from product_events`;
    expect(stillThere.n).toBe(2);

    const first = runPurge(url, "--execute");
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout).deleted).toEqual({
      productEvents: 1, auditLogs: 1, recoveryTokens: 1, passwordResetTokens: 1, emailVerificationTokens: 1, appleRegistrations: 1, rateLimits: 1,
    });
    // Les journaux ne contiennent que des compteurs.
    for (const output of [dryRun.stdout, first.stdout]) {
      expect(output).not.toContain("example.test");
      expect(output).not.toContain("Camille");
      expect(output).not.toContain("LOY1:");
    }

    const second = runPurge(url, "--execute");
    expect(second.status, second.stderr).toBe(0);
    expect(Object.values(JSON.parse(second.stdout).deleted)).toEqual([0, 0, 0, 0, 0, 0, 0]);

    const [kept] = await sql`
      select
        (select count(*)::int from product_events) as product_events,
        (select count(*)::int from audit_logs) as audit_logs,
        (select count(*)::int from card_recovery_tokens where used_at is null) as active_recovery,
        (select count(*)::int from password_reset_tokens) as password_reset_tokens,
        (select count(*)::int from email_verification_tokens) as email_verification_tokens,
        (select count(*)::int from rate_limits) as rate_limits,
        (select count(*)::int from wallet_passes) as wallet_passes,
        (select count(*)::int from transactions) as transactions,
        (select count(*)::int from customers where email is not null) as customers,
        (select balance from cards where id=${card.id}) as balance
    `;
    // Données métier intactes : ledger, carte, solde, client, pass.
    expect(kept).toEqual({
      product_events: 1, audit_logs: 1, active_recovery: 1, password_reset_tokens: 1, email_verification_tokens: 1,
      rate_limits: 1, wallet_passes: 1, transactions: 1, customers: 1, balance: 2,
    });
  } finally {
    await sql.end({ timeout: 5 });
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.end({ timeout: 5 });
  }
});

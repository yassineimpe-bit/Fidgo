import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

// Restore drill de database-backup : l'empreinte d'une copie fidèle doit être
// identique à la source, et toute perte ou altération doit être détectée.
const fingerprint = path.join(process.cwd(), "scripts", "db-fingerprint.mjs");
const setup = path.join(process.cwd(), "scripts", "db-setup.mjs");
const seed = path.join(process.cwd(), "scripts", "seed-demo.mjs");
const verify = path.join(process.cwd(), "scripts", "verify-db-integrity.mjs");

function databaseUrl(name: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

function run(scriptPath: string, url: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], { env: { ...process.env, ...env, DATABASE_URL: url }, encoding: "utf8" });
}

test("backup : l'empreinte d'une copie est identique à la source et détecte toute altération", async () => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const source = `backup_src_${suffix}`;
  const copy = `backup_copy_${suffix}`;
  const admin = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
  const dir = mkdtempSync(path.join(tmpdir(), "backup-fingerprint-e2e-"));
  try {
    await admin.unsafe(`create database ${source}`);
    expect(run(setup, databaseUrl(source)).status).toBe(0);
    const seeded = run(seed, databaseUrl(source), [], {
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      DEMO_OWNER_EMAIL: `backup-${suffix}@example.test`,
      DEMO_OWNER_PASSWORD: "Backup-drill-password-123!",
    });
    expect(seeded.status, seeded.stderr).toBe(0);
    // La démo a un état de facturation : db:verify doit passer sur la source.
    const sourceVerify = run(verify, databaseUrl(source));
    expect(sourceVerify.status, sourceVerify.stdout).toBe(0);
    const sourceSql = postgres(databaseUrl(source), { max: 1, prepare: false, onnotice: () => {} });
    try {
      await sourceSql`insert into product_events(establishment_id,event_type) select id,'SCAN_SUCCESS' from establishments limit 1`;
    } finally {
      await sourceSql.end({ timeout: 5 });
    }

    const read = (name: string) => {
      const result = run(fingerprint, databaseUrl(name));
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    const before = read(source);
    const after = read(source);
    expect(after).toBe(before);
    const parsed = JSON.parse(before);
    expect(Number(parsed.rows.cards)).toBeGreaterThan(0);
    expect(Number(parsed.rows.transactions)).toBeGreaterThan(0);
    expect(parsed.aggregates.ledgerBalanceMismatches).toBe("0");
    // Agrégats seulement : aucune donnée personnelle.
    expect(before).not.toContain("@example.test");
    expect(before).not.toContain("LOY1:");

    // Copie fidèle (équivalent d'un restore) : empreinte identique.
    await admin.unsafe(`create database ${copy} template ${source}`);
    writeFileSync(path.join(dir, "before.json"), before);
    writeFileSync(path.join(dir, "after.json"), after);
    writeFileSync(path.join(dir, "restored.json"), read(copy));
    const compare = () => spawnSync(process.execPath, [fingerprint, "--compare", ...["before", "after", "restored"].map((n) => path.join(dir, `${n}.json`))], { encoding: "utf8" });
    const identical = compare();
    expect(identical.status, identical.stdout).toBe(0);
    expect(identical.stdout).toContain("Empreinte identique");

    // Restauration altérée : un solde modifié et une ligne perdue sont détectés.
    const copySql = postgres(databaseUrl(copy), { max: 1, prepare: false, onnotice: () => {} });
    try {
      await copySql`update cards set balance = balance + 1 where id = (select id from cards limit 1)`;
      await copySql`delete from product_events where id = (select id from product_events limit 1)`;
    } finally {
      await copySql.end({ timeout: 5 });
    }
    writeFileSync(path.join(dir, "restored.json"), read(copy));
    const altered = compare();
    expect(altered.status).toBe(1);
    expect(altered.stdout).toContain("ne correspond pas");
    expect(altered.stdout).toContain("table product_events : 1 ligne(s) attendue(s), 0 trouvée(s)");
    expect(altered.stdout).toContain("agrégats différents");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await admin.unsafe(`drop database if exists ${copy} with (force)`);
    await admin.unsafe(`drop database if exists ${source} with (force)`);
    await admin.end({ timeout: 5 });
  }
});

// Mesure de la latence de connexion, phase par phase, sur une base locale.
//
//   DATABASE_URL=... AUTH_SECRET=... node scripts/bench-login.mjs [--runs 20] [--url http://127.0.0.1:3100]
//
// Rejoue, dans le même ordre que POST /api/auth/login, chaque opération :
// validation, rate limit IP, lecture du compte, bcrypt, contrôle du commerce,
// remise à zéro du compteur, signature JWT. Avec --url, mesure aussi le
// parcours HTTP complet contre un serveur déjà démarré (next start).
// Crée un commerce et un compte jetables, marqués « bench-login », puis les
// laisse en base locale : ne jamais pointer vers la production.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import postgres from "postgres";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const runs = Number(option("runs", "20"));
const url = option("url", "");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requis (base locale uniquement).");
if (/neon\.tech|retiko\.fr/i.test(process.env.DATABASE_URL)) throw new Error("Refus : base distante détectée.");

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "bench-secret-at-least-32-characters-long");
const password = "Bench-password-123!";
const marker = `bench-login-${Date.now()}`;
const email = `${marker}@example.com`;

const now = () => Number(process.hrtime.bigint()) / 1e6;
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { p50: pick(50), p95: pick(95), max: sorted.at(-1) };
};
const fmt = (value) => `${value.toFixed(1)} ms`;

try {
  const hash = await bcrypt.hash(password, 12);
  const [establishment] = await sql`
    insert into establishments(slug,name) values(${marker},${"Bench login"}) returning id
  `;
  await sql`
    insert into staff_users(establishment_id,email,password_hash,role,email_verified_at)
    values(${establishment.id},${email},${hash},'OWNER',now())
  `;

  const phases = { parse: [], rateLimit: [], dbLookup: [], bcrypt: [], establishment: [], reset: [], sign: [], total: [] };
  for (let run = 0; run < runs; run += 1) {
    const start = now();
    let mark = start;
    const lap = (name) => { const t = now(); phases[name].push(t - mark); mark = t; };

    const body = JSON.parse(JSON.stringify({ email, password }));
    String(body.email).trim().toLowerCase();
    lap("parse");
    const key = `bench:${randomBytes(8).toString("hex")}`;
    await sql`
      insert into rate_limits (key_hash, hits, window_started_at) values (${key}, 1, now())
      on conflict (key_hash) do update set hits = rate_limits.hits + 1 returning hits
    `;
    lap("rateLimit");
    const [user] = await sql`
      select id, establishment_id, email, password_hash, role, active, token_version, email_verified_at
      from staff_users where lower(email)=${email} limit 1
    `;
    lap("dbLookup");
    await bcrypt.compare(password, String(user.password_hash));
    lap("bcrypt");
    await sql`select status, onboarding_step from establishments where id=${user.establishment_id}`;
    lap("establishment");
    await sql`delete from rate_limits where key_hash = ${key}`;
    lap("reset");
    await new SignJWT({ staffId: String(user.id) }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret);
    lap("sign");
    phases.total.push(now() - start);
  }

  console.log(`Phases (${runs} connexions, bcryptjs coût 12, base locale)`);
  for (const [name, values] of Object.entries(phases)) {
    const { p50, p95, max } = stats(values);
    console.log(`  ${name.padEnd(14)} p50 ${fmt(p50).padStart(10)}  p95 ${fmt(p95).padStart(10)}  max ${fmt(max).padStart(10)}`);
  }

  if (url) {
    const totals = [];
    for (let run = 0; run < runs; run += 1) {
      const started = now();
      const response = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: url,
          // IP logique distincte : le quota (10/15 min par IP) ne doit pas fausser la mesure.
          "x-real-ip": `2001:db8::${(run + 1).toString(16)}`,
        },
        body: JSON.stringify({ email, password }),
      });
      await response.text();
      if (!response.ok) throw new Error(`Connexion refusée (${response.status}) au passage ${run + 1}`);
      totals.push(now() - started);
    }
    const { p50, p95, max } = stats(totals);
    console.log(`HTTP POST /api/auth/login (${runs} connexions réussies) : p50 ${fmt(p50)}  p95 ${fmt(p95)}  max ${fmt(max)}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}

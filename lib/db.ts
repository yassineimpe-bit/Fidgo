import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
export const databaseConfigured = Boolean(databaseUrl);

// Keep module imports/builds safe before production secrets are attached.
// Runtime database access still fails closed, and /api/health reports 503.
const fallbackUrl = "postgres://fidgo:fidgo@127.0.0.1:5432/fidgo_unconfigured";

export const sql = postgres(databaseUrl || fallbackUrl, {
  max: 5,
  prepare: false,
  connect_timeout: 2,
});

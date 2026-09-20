import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
export const databaseConfigured = Boolean(databaseUrl);

// Keep module imports/builds safe before production secrets are attached.
// Runtime database access still fails closed, and /api/health reports 503.
const fallbackUrl = "postgres://fidgo:fidgo@127.0.0.1:5432/fidgo_unconfigured";
const connectionUrl = databaseUrl || fallbackUrl;

type SqlClient = ReturnType<typeof postgres>;
type DbGlobal = typeof globalThis & {
  __retikoSql?: SqlClient;
  __retikoSqlUrl?: string;
};

const globalForDb = globalThis as DbGlobal;

function createSqlClient() {
  return postgres(connectionUrl, {
    max: 5,
    prepare: false,
    connect_timeout: 2,
  });
}

// Next dev reloads server modules repeatedly. Reuse the same pool across HMR
// so local/E2E runs do not leak connection pools until Postgres is exhausted.
const reusableSql =
  process.env.NODE_ENV !== "production" && globalForDb.__retikoSqlUrl === connectionUrl
    ? globalForDb.__retikoSql
    : undefined;

export const sql = reusableSql ?? createSqlClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__retikoSql = sql;
  globalForDb.__retikoSqlUrl = connectionUrl;
}

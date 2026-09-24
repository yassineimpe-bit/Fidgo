import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL est requis.");
  process.exit(1);
}

const execute = process.argv.includes("--execute");
const batch = 5_000;
const retention = {
  productEventsDays: 180,
  auditLogsDays: 730,
  recoveryTokensDays: 30,
  passwordResetTokensDays: 30,
  emailVerificationTokensDays: 30,
  revokedAppleRegistrationsDays: 30,
  rateLimitsDays: 2,
};
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

try {
  const [{ locked }] = await sql`select pg_try_advisory_lock(hashtext('retiko-data-lifecycle')) as locked`;
  if (!locked) throw new Error("Une purge data lifecycle est déjà en cours.");

  if (!execute) {
    const [counts] = await sql`
      select
        (select count(*)::int from product_events where created_at < now() - (${retention.productEventsDays}::int * interval '1 day')) as product_events,
        (select count(*)::int from audit_logs where created_at < now() - (${retention.auditLogsDays}::int * interval '1 day')) as audit_logs,
        (select count(*)::int from card_recovery_tokens where
          expires_at < now() - (${retention.recoveryTokensDays}::int * interval '1 day')
          or used_at < now() - (${retention.recoveryTokensDays}::int * interval '1 day')) as recovery_tokens,
        (select count(*)::int from password_reset_tokens where
          expires_at < now() - (${retention.passwordResetTokensDays}::int * interval '1 day')
          or used_at < now() - (${retention.passwordResetTokensDays}::int * interval '1 day')) as password_reset_tokens,
        (select count(*)::int from email_verification_tokens where
          expires_at < now() - (${retention.emailVerificationTokensDays}::int * interval '1 day')
          or used_at < now() - (${retention.emailVerificationTokensDays}::int * interval '1 day')) as email_verification_tokens,
        (select count(*)::int from apple_wallet_registrations r join wallet_passes wp on wp.id=r.wallet_pass_id
          where wp.status='revoked' and wp.updated_at < now() - (${retention.revokedAppleRegistrationsDays}::int * interval '1 day')) as apple_registrations,
        (select count(*)::int from rate_limits where window_started_at < now() - (${retention.rateLimitsDays}::int * interval '1 day')) as rate_limits
    `;
    console.log(JSON.stringify({ mode: "dry-run", retention, eligible: counts, batchLimit: batch }, null, 2));
  } else {
    const deleted = await sql.begin(async (tx) => {
      const productEvents = await tx`
        delete from product_events where id in (
          select id from product_events
          where created_at < now() - (${retention.productEventsDays}::int * interval '1 day')
          order by created_at limit ${batch}
        ) returning id
      `;
      const auditLogs = await tx`
        delete from audit_logs where id in (
          select id from audit_logs
          where created_at < now() - (${retention.auditLogsDays}::int * interval '1 day')
          order by created_at limit ${batch}
        ) returning id
      `;
      const recoveryTokens = await tx`
        delete from card_recovery_tokens where id in (
          select id from card_recovery_tokens
          where expires_at < now() - (${retention.recoveryTokensDays}::int * interval '1 day')
            or used_at < now() - (${retention.recoveryTokensDays}::int * interval '1 day')
          order by created_at limit ${batch}
        ) returning id
      `;
      const passwordResetTokens = await tx`
        delete from password_reset_tokens where id in (
          select id from password_reset_tokens
          where expires_at < now() - (${retention.passwordResetTokensDays}::int * interval '1 day')
            or used_at < now() - (${retention.passwordResetTokensDays}::int * interval '1 day')
          order by created_at limit ${batch}
        ) returning id
      `;
      const emailVerificationTokens = await tx`
        delete from email_verification_tokens where id in (
          select id from email_verification_tokens
          where expires_at < now() - (${retention.emailVerificationTokensDays}::int * interval '1 day')
            or used_at < now() - (${retention.emailVerificationTokensDays}::int * interval '1 day')
          order by created_at limit ${batch}
        ) returning id
      `;
      const appleRegistrations = await tx`
        delete from apple_wallet_registrations where id in (
          select r.id from apple_wallet_registrations r
          join wallet_passes wp on wp.id=r.wallet_pass_id
          where wp.status='revoked'
            and wp.updated_at < now() - (${retention.revokedAppleRegistrationsDays}::int * interval '1 day')
          order by r.created_at limit ${batch}
        ) returning id
      `;
      const rateLimits = await tx`
        delete from rate_limits where key_hash in (
          select key_hash from rate_limits
          where window_started_at < now() - (${retention.rateLimitsDays}::int * interval '1 day')
          order by window_started_at limit ${batch}
        ) returning key_hash
      `;
      return {
        productEvents: productEvents.length,
        auditLogs: auditLogs.length,
        recoveryTokens: recoveryTokens.length,
        passwordResetTokens: passwordResetTokens.length,
        emailVerificationTokens: emailVerificationTokens.length,
        appleRegistrations: appleRegistrations.length,
        rateLimits: rateLimits.length,
      };
    });
    console.log(JSON.stringify({ mode: "execute", retention, deleted, batchLimit: batch }, null, 2));
  }
} finally {
  await sql.end({ timeout: 5 });
}

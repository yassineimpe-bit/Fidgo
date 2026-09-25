import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { getSession, sessionCookie, signSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { withApiErrorHandling } from "@/lib/observability";
import { enforceRateLimit } from "@/lib/rate-limit";
import { PRIVATE_HEADERS, rejectCrossOrigin } from "@/lib/security";
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUri, verifyTotp } from "@/lib/totp";
import { consumeSecondFactor, enabledTwoFactor, isMissingTable } from "@/lib/two-factor";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

async function handleGet() {
  const session = await getSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const [row] = await sql`
      select enabled_at,
        (select count(*)::int from staff_two_factor_recovery_codes c where c.staff_user_id=t.staff_user_id and c.used_at is null) as remaining
      from staff_two_factor t where staff_user_id=${session.staffId}
    `;
    return json({ available: true, enabled: Boolean(row?.enabled_at), recoveryCodesRemaining: row?.enabled_at ? Number(row.remaining) : 0 });
  } catch (error) {
    if (isMissingTable(error)) return json({ available: false, enabled: false, recoveryCodesRemaining: 0 });
    throw error;
  }
}

async function storeRecoveryCodes(tx: typeof sql, staffId: string, establishmentId: string) {
  const codes = generateRecoveryCodes();
  await tx`delete from staff_two_factor_recovery_codes where staff_user_id=${staffId}`;
  for (const code of codes) {
    await tx`
      insert into staff_two_factor_recovery_codes(staff_user_id, establishment_id, code_hash)
      values(${staffId}, ${establishmentId}, ${hashRecoveryCode(code)})
    `;
  }
  return codes;
}

async function handlePost(req: Request) {
  const originError = rejectCrossOrigin(req);
  if (originError) return originError;
  const session = await getSession();
  if (!session) return json({ error: "UNAUTHORIZED" }, 401);
  const limited = await enforceRateLimit(req, `account-2fa:${session.staffId}`, 20, 60 * 60);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, 256) : "";
  const code = typeof body?.code === "string" ? body.code.slice(0, 12) : "";
  const recoveryCode = typeof body?.recoveryCode === "string" ? body.recoveryCode.slice(0, 24) : "";

  const [staff] = await sql`
    select password_hash, email from staff_users
    where id=${session.staffId} and establishment_id=${session.establishmentId} and active=true
  `;
  if (!staff) return json({ error: "UNAUTHORIZED" }, 401);
  const passwordOk = () => bcrypt.compare(password, String(staff.password_hash));

  try {
    if (action === "setup") {
      // Mot de passe redemandé : une session laissée ouverte ne suffit pas.
      if (!password || !(await passwordOk())) return json({ error: "INVALID_PASSWORD" }, 401);
      const secret = generateTotpSecret();
      const [pending] = await sql`
        insert into staff_two_factor(staff_user_id, establishment_id, secret_encrypted)
        values(${session.staffId}, ${session.establishmentId}, ${encryptTotpSecret(secret)})
        on conflict (staff_user_id) do update
          set secret_encrypted=excluded.secret_encrypted, last_used_step=null, updated_at=now()
          where staff_two_factor.enabled_at is null
        returning staff_user_id
      `;
      if (!pending) return json({ error: "ALREADY_ENABLED" }, 409);
      const uri = otpauthUri(secret, String(staff.email));
      const qr = await QRCode.toDataURL(uri, { width: 240, margin: 1, errorCorrectionLevel: "M" });
      return json({ secret, otpauthUri: uri, qr });
    }

    if (action === "enable") {
      const [row] = await sql`select secret_encrypted from staff_two_factor where staff_user_id=${session.staffId} and enabled_at is null`;
      if (!row) return json({ error: "NOT_PENDING" }, 409);
      const secret = decryptTotpSecret(String(row.secret_encrypted));
      const step = secret ? verifyTotp(secret, code, null) : null;
      if (step === null) return json({ error: "INVALID_2FA_CODE" }, 401);
      const result = await sql.begin(async (tx) => {
        const [enabled] = await tx`
          update staff_two_factor set enabled_at=now(), last_used_step=${step}, updated_at=now()
          where staff_user_id=${session.staffId} and enabled_at is null
          returning staff_user_id
        `;
        if (!enabled) return null;
        const recoveryCodes = await storeRecoveryCodes(tx as unknown as typeof sql, session.staffId, session.establishmentId);
        // Les autres appareils connectés sans second facteur sont déconnectés.
        const [version] = await tx`
          update staff_users set token_version=token_version+1, updated_at=now()
          where id=${session.staffId} returning token_version
        `;
        await tx`
          insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id)
          values(${session.establishmentId}, ${session.staffId}, 'STAFF_TWO_FACTOR_ENABLED', 'staff_user', ${session.staffId})
        `;
        return { recoveryCodes, tokenVersion: Number(version.token_version) };
      });
      if (!result) return json({ error: "NOT_PENDING" }, 409);
      const response = json({ recoveryCodes: result.recoveryCodes });
      response.cookies.set(sessionCookie(await signSession({ ...session, tokenVersion: result.tokenVersion })));
      return response;
    }

    if (action === "disable" || action === "regenerate") {
      const factor = await enabledTwoFactor(session.staffId);
      if (!factor) return json({ error: "NOT_ENABLED" }, 409);
      if (action === "disable" && (!password || !(await passwordOk()))) return json({ error: "INVALID_PASSWORD" }, 401);
      const method = await consumeSecondFactor(session.staffId, factor, code ? { code } : { recoveryCode });
      if (!method) return json({ error: "INVALID_2FA_CODE" }, 401);
      if (action === "regenerate") {
        const recoveryCodes = await sql.begin(async (tx) => {
          const codes = await storeRecoveryCodes(tx as unknown as typeof sql, session.staffId, session.establishmentId);
          await tx`
            insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id)
            values(${session.establishmentId}, ${session.staffId}, 'STAFF_TWO_FACTOR_RECOVERY_REGENERATED', 'staff_user', ${session.staffId})
          `;
          return codes;
        });
        return json({ recoveryCodes });
      }
      await sql.begin(async (tx) => {
        await tx`delete from staff_two_factor_recovery_codes where staff_user_id=${session.staffId}`;
        await tx`delete from staff_two_factor where staff_user_id=${session.staffId}`;
        await tx`
          insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
          values(${session.establishmentId}, ${session.staffId}, 'STAFF_TWO_FACTOR_DISABLED', 'staff_user', ${session.staffId}, ${tx.json({ method })})
        `;
      });
      return json({ ok: true });
    }

    return json({ error: "INVALID_ACTION" }, 400);
  } catch (error) {
    if (isMissingTable(error)) return json({ error: "TWO_FACTOR_UNAVAILABLE" }, 503);
    throw error;
  }
}

export const GET = withApiErrorHandling("ACCOUNT_TWO_FACTOR_GET", handleGet);
export const POST = withApiErrorHandling("ACCOUNT_TWO_FACTOR", handlePost);

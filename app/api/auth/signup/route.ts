import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { databaseConfigured, sql } from "@/lib/db";
import { id } from "@/lib/ids";
import { rateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security";
import { isEmail } from "@/lib/input";
import { safeErrorCode } from "@/lib/observability";
import { createPilotSubscription } from "@/lib/billing";
import { isValidNewPassword } from "@/lib/password-reset";
import { getAppUrl } from "@/lib/app-url";
import { emailDeliveryConfigured, sendEmailVerificationEmail } from "@/lib/email";
import { createEmailVerificationToken } from "@/lib/email-verification";

function verificationTestMode() {
  return process.env.NODE_ENV !== "production" && process.env.EMAIL_VERIFICATION_TEST_MODE === "true";
}

function slugify(input: string) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status });

  // Ne pas laisser le formulaire tenter une connexion localhost ou créer un
  // compte sans pouvoir ensuite signer la session. En production mal
  // configurée, on renvoie une indisponibilité explicite au lieu d'un 500
  // générique après plusieurs secondes.
  if (!databaseConfigured || !process.env.AUTH_SECRET?.trim()) {
    return NextResponse.json(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const limited = await rateLimit(request, "signup", 5, 60 * 60);
  if (!limited.allowed) return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const restaurantName = String(body.restaurantName || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (restaurantName.length < 2 || !isEmail(email) || !isValidNewPassword(password)) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const baseSlug = slugify(restaurantName) || "commerce";
  const slug = `${baseSlug}-${id().slice(-4).toLowerCase()}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const verification = createEmailVerificationToken();
  const testMode = verificationTestMode();
  const appUrl = getAppUrl();

  if (!testMode && (!emailDeliveryConfigured() || !appUrl)) {
    return NextResponse.json(
      { error: "EMAIL_VERIFICATION_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await sql.begin(async (tx) => {
      const establishment = (await tx`insert into establishments(id,slug,name) values(${id()},${slug},${restaurantName}) returning id,slug,name`)[0];
      const staff = (await tx`
        insert into staff_users(id,establishment_id,email,password_hash,role,email_verified_at)
        values(${id()},${establishment.id},${email},${passwordHash},'OWNER',null)
        returning id,email,role,token_version
      `)[0];
      await tx`
        insert into email_verification_tokens(staff_user_id,token_hash,expires_at)
        values(${staff.id},${verification.tokenHash},${verification.expiresAt})
      `;
      await tx`insert into loyalty_programs(id,establishment_id,program_name,mode,stamps_per_visit,reward_threshold,reward_label) values(${id()},${establishment.id},'Programme fidélité','STAMPS',1,10,'1 récompense offerte')`;
      // L'essai est un état local. Aucun appel Stripe n'est effectué pendant
      // l'inscription : une panne ou un flag désactivé ne peut donc pas créer
      // un commerce à moitié initialisé.
      await createPilotSubscription(tx, String(establishment.id));
      return { establishment, staff };
    });

    if (testMode) {
      return NextResponse.json(
        {
          ok: true,
          slug: result.establishment.slug,
          verificationRequired: true,
          verificationToken: verification.token,
        },
        { status: 202, headers: { "cache-control": "no-store" } },
      );
    }

    const verificationUrl = `${appUrl}/verify-email?token=${verification.token}`;
    try {
      const delivered = await sendEmailVerificationEmail({
        to: email,
        verificationUrl,
        idempotencyKey: `email-verification-${verification.tokenHash}`,
      });
      await sql`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values(
          ${result.establishment.id},
          ${result.staff.id},
          'EMAIL_VERIFICATION_EMAIL_SENT',
          'staff_user',
          ${result.staff.id},
          ${sql.json({ provider: "resend", messageId: delivered.messageId })}
        )
      `;
    } catch (error) {
      const code = safeErrorCode(error, "EMAIL_SEND_FAILED");
      console.error("SIGNUP_VERIFICATION_EMAIL_FAILED", { code });
      try {
        await sql`
          insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
          values(
            ${result.establishment.id},
            ${result.staff.id},
            'EMAIL_VERIFICATION_EMAIL_FAILED',
            'staff_user',
            ${result.staff.id},
            ${sql.json({ code })}
          )
        `;
      } catch {}
      return NextResponse.json(
        { error: "EMAIL_VERIFICATION_SEND_FAILED", accountCreated: true },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: true, slug: result.establishment.slug, verificationRequired: true },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (String(error).includes("staff_users_email_key")) return NextResponse.json({ error: "EMAIL_EXISTS" }, { status: 409 });
    // Une exception ici (schema desynchronise, base injoignable, etc.) ne doit
    // jamais remonter comme une page d'erreur Next.js sans corps JSON : le
    // client ne saurait plus rien afficher. On journalise le detail cote
    // serveur (visible dans les logs Vercel) et on renvoie un code stable.
    console.error("SIGNUP_FAILED", { code: safeErrorCode(error, "SIGNUP_FAILED") });
    return NextResponse.json({ error: "SIGNUP_FAILED" }, { status: 500 });
  }
}

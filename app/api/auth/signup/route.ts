import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { databaseConfigured, sql } from "@/lib/db";
import { id } from "@/lib/ids";
import { rateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security";
import { isEmail } from "@/lib/input";
import { safeErrorCode } from "@/lib/observability";
import { BILLING_TRIAL_DAYS, createPilotSubscription } from "@/lib/billing";
import { isValidNewPassword } from "@/lib/password-reset";
import { getAppUrl } from "@/lib/app-url";
import { emailDeliveryConfigured, sendEmailVerificationEmail } from "@/lib/email";
import { createEmailVerificationToken, emailVerificationTestMode } from "@/lib/email-verification";

function slugify(input: string) {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function POST(request: Request) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ error: origin.error }, { status: origin.status });

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
  if (restaurantName.length < 2 || !isEmail(email) || !isValidNewPassword(password)) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const testMode = emailVerificationTestMode();
  const appUrl = getAppUrl();
  if (!testMode && (!emailDeliveryConfigured() || !appUrl)) {
    return NextResponse.json(
      { error: "EMAIL_VERIFICATION_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const baseSlug = slugify(restaurantName) || "commerce";
  const slug = `${baseSlug}-${id().slice(-4).toLowerCase()}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const verification = createEmailVerificationToken();

  try {
    const result = await sql.begin(async (tx) => {
      const [existing] = await tx`
        select
          s.id as staff_id,
          s.establishment_id,
          s.email_verified_at,
          s.role,
          e.status
        from staff_users s
        join establishments e on e.id = s.establishment_id
        where lower(s.email) = ${email}
        limit 1
        for update of s, e
      `;

      if (existing) {
        if (existing.email_verified_at || String(existing.role) !== "OWNER" || existing.status !== "active") {
          throw new Error("EMAIL_EXISTS_VERIFIED");
        }

        const staffId = String(existing.staff_id);
        const establishmentId = String(existing.establishment_id);
        const [subscription] = await tx`
          select external_customer_id, external_subscription_id
          from subscriptions
          where establishment_id = ${establishmentId}
          for update
        `;
        // Un compte public non vérifié n'a jamais accès au dashboard ni à la
        // facturation. Si des identifiants Stripe existent malgré tout, on
        // refuse la reprise automatique plutôt que d'écraser un état ambigu.
        if (subscription?.external_customer_id || subscription?.external_subscription_id) {
          throw new Error("EMAIL_EXISTS_VERIFIED");
        }

        await tx`
          update email_verification_tokens
          set used_at = coalesce(used_at, now())
          where staff_user_id = ${staffId} and used_at is null
        `;
        await tx`
          update password_reset_tokens
          set used_at = coalesce(used_at, now())
          where staff_user_id = ${staffId} and used_at is null
        `;
        await tx`
          update staff_users
          set password_hash = ${passwordHash},
              active = true,
              token_version = token_version + 1,
              email_verified_at = null,
              updated_at = now()
          where id = ${staffId}
        `;
        await tx`
          update establishments
          set name = ${restaurantName},
              slug = ${slug},
              onboarding_step = 1,
              updated_at = now()
          where id = ${establishmentId}
        `;
        await tx`
          update subscriptions
          set plan = 'PILOT',
              billing_interval = null,
              status = 'trial',
              trial_ends_at = now() + (${BILLING_TRIAL_DAYS}::int * interval '1 day'),
              current_period_end = null,
              cancel_at_period_end = false,
              stripe_last_event_created = null,
              stripe_last_event_id = null,
              stripe_checkout_session_id = null,
              stripe_checkout_plan = null,
              stripe_checkout_pending_at = null,
              stripe_checkout_claim_token = null,
              updated_at = now()
          where establishment_id = ${establishmentId}
        `;
        await tx`
          insert into email_verification_tokens(staff_user_id, token_hash, expires_at)
          values(${staffId}, ${verification.tokenHash}, ${verification.expiresAt})
        `;
        await tx`
          insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
          values(
            ${establishmentId},
            ${staffId},
            'EMAIL_VERIFICATION_SIGNUP_REPLACED',
            'staff_user',
            ${staffId},
            ${tx.json({ previousPendingSignupInvalidated: true })}
          )
        `;

        return {
          establishment: { id: establishmentId, slug, name: restaurantName },
          staff: { id: staffId },
          replacedPendingSignup: true,
        };
      }

      const establishment = (await tx`
        insert into establishments(id, slug, name, onboarding_step)
        values(${id()}, ${slug}, ${restaurantName}, 1)
        returning id, slug, name
      `)[0];
      const staff = (await tx`
        insert into staff_users(id, establishment_id, email, password_hash, role, email_verified_at)
        values(${id()}, ${establishment.id}, ${email}, ${passwordHash}, 'OWNER', null)
        returning id, email, role, token_version
      `)[0];
      await tx`
        insert into email_verification_tokens(staff_user_id, token_hash, expires_at)
        values(${staff.id}, ${verification.tokenHash}, ${verification.expiresAt})
      `;
      await tx`
        insert into loyalty_programs(id, establishment_id, program_name, mode, stamps_per_visit, reward_threshold, reward_label)
        values(${id()}, ${establishment.id}, 'Programme fidélité', 'STAMPS', 1, 10, '1 récompense offerte')
      `;
      await createPilotSubscription(tx, String(establishment.id));
      return { establishment, staff, replacedPendingSignup: false };
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
    let messageId: string;
    try {
      const delivered = await sendEmailVerificationEmail({
        to: email,
        commerceName: restaurantName,
        verificationUrl,
        idempotencyKey: `email-verification-${verification.tokenHash}`,
      });
      messageId = delivered.messageId;
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

    try {
      await sql`
        insert into audit_logs(establishment_id, staff_user_id, action, entity_type, entity_id, metadata)
        values(
          ${result.establishment.id},
          ${result.staff.id},
          'EMAIL_VERIFICATION_EMAIL_SENT',
          'staff_user',
          ${result.staff.id},
          ${sql.json({
            provider: "resend",
            messageId,
            replacedPendingSignup: result.replacedPendingSignup,
          })}
        )
      `;
    } catch (error) {
      console.error("SIGNUP_VERIFICATION_AUDIT_FAILED", {
        code: safeErrorCode(error, "EMAIL_VERIFICATION_AUDIT_FAILED"),
      });
    }

    return NextResponse.json(
      { ok: true, slug: result.establishment.slug, verificationRequired: true },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "EMAIL_EXISTS_VERIFIED" || String(error).includes("staff_users_email_key")) {
      return NextResponse.json({ error: "EMAIL_EXISTS" }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    console.error("SIGNUP_FAILED", { code: safeErrorCode(error, "SIGNUP_FAILED") });
    return NextResponse.json({ error: "SIGNUP_FAILED" }, { status: 500 });
  }
}

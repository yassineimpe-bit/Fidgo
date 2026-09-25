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
import { createEmailVerificationToken, emailVerificationTestMode } from "@/lib/email-verification";
import { ACCEPTED_DOCUMENTS, LEGAL_VERSION, hasAcceptedCurrentTerms, marketingOptIn } from "@/lib/legal";
import { DEFAULT_COOLDOWN_SECONDS } from "@/lib/cooldown";

// Preuve contractuelle : document, version affichée, date et contexte. Une
// réinscription sur une adresse encore non vérifiée ajoute sa propre preuve
// (la plus récente fait foi) sans effacer l'historique.
async function recordLegalAcceptance(tx: typeof sql, establishmentId: unknown, staffId: unknown) {
  for (const document of ACCEPTED_DOCUMENTS) {
    await tx`
      insert into legal_acceptances(establishment_id,staff_user_id,document_type,document_version,source)
      values(${String(establishmentId)},${String(staffId)},${document},${LEGAL_VERSION},'signup')
    `;
  }
}

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
  // Contrôle serveur : la case du formulaire ne suffit pas.
  if (!hasAcceptedCurrentTerms(body)) {
    return NextResponse.json({ error: "LEGAL_ACCEPTANCE_REQUIRED" }, { status: 400 });
  }
  const marketing = marketingOptIn(body);

  const baseSlug = slugify(restaurantName) || "commerce";
  const slug = `${baseSlug}-${id().slice(-4).toLowerCase()}`;
  const passwordHash = await bcrypt.hash(password, 12);
  const verification = createEmailVerificationToken();
  const testMode = emailVerificationTestMode();
  const appUrl = getAppUrl();

  if (!testMode && (!emailDeliveryConfigured() || !appUrl)) {
    return NextResponse.json(
      { error: "EMAIL_VERIFICATION_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await sql.begin(async (tx) => {
      // Sérialise les inscriptions pour une même adresse. Cela ferme la course
      // "deux créations simultanées" et permet de remplacer sans ambiguïté un
      // compte public encore non vérifié.
      await tx`select pg_advisory_xact_lock(hashtext(${email}))`;

      const existingRows = await tx`
        select
          s.id,
          s.establishment_id,
          s.email_verified_at,
          s.active,
          s.role,
          s.token_version,
          e.status
        from staff_users s
        join establishments e on e.id=s.establishment_id
        where lower(s.email)=${email}
        limit 1
        for update of s, e
      `;
      const existing = existingRows[0];

      if (existing) {
        // Un compte déjà vérifié, désactivé, non-OWNER ou rattaché à un
        // commerce suspendu ne doit jamais pouvoir être repris via signup.
        if (
          existing.email_verified_at
          || !existing.active
          || String(existing.role) !== "OWNER"
          || String(existing.status) !== "active"
        ) {
          throw new Error("EMAIL_EXISTS_VERIFIED");
        }

        // Anti pré-détournement : une nouvelle inscription sur une adresse
        // encore non vérifiée remplace le secret choisi précédemment et
        // invalide tous les anciens liens de vérification. Le prochain lien
        // reçu par le propriétaire de l'adresse ne peut donc activer qu'un
        // mot de passe issu de la dernière inscription.
        await tx`
          update staff_users
          set password_hash=${passwordHash},
              token_version=token_version+1,
              marketing_consent=${marketing},
              marketing_consent_at=${marketing ? new Date() : null},
              updated_at=now()
          where id=${existing.id}
        `;
        await recordLegalAcceptance(tx, existing.establishment_id, existing.id);
        await tx`
          update establishments
          set name=${restaurantName},
              slug=${slug},
              onboarding_step=1,
              updated_at=now()
          where id=${existing.establishment_id}
        `;
        await tx`
          update email_verification_tokens
          set used_at=coalesce(used_at, now())
          where staff_user_id=${existing.id}
        `;
        await tx`
          insert into email_verification_tokens(staff_user_id,token_hash,expires_at)
          values(${existing.id},${verification.tokenHash},${verification.expiresAt})
        `;

        return {
          establishment: { id: existing.establishment_id, slug, name: restaurantName },
          staff: {
            id: existing.id,
            email,
            role: existing.role,
            token_version: Number(existing.token_version) + 1,
          },
        };
      }

      const establishment = (await tx`
        insert into establishments(id,slug,name,onboarding_step)
        values(${id()},${slug},${restaurantName},1)
        returning id,slug,name
      `)[0];
      const staff = (await tx`
        insert into staff_users(id,establishment_id,email,password_hash,role,email_verified_at,marketing_consent,marketing_consent_at)
        values(${id()},${establishment.id},${email},${passwordHash},'OWNER',null,${marketing},${marketing ? new Date() : null})
        returning id,email,role,token_version
      `)[0];
      await recordLegalAcceptance(tx, establishment.id, staff.id);
      await tx`
        insert into email_verification_tokens(staff_user_id,token_hash,expires_at)
        values(${staff.id},${verification.tokenHash},${verification.expiresAt})
      `;
      await tx`
        insert into loyalty_programs(id,establishment_id,program_name,mode,stamps_per_visit,reward_threshold,reward_label,cooldown_seconds)
        values(${id()},${establishment.id},'Programme fidélité','STAMPS',1,10,'1 récompense offerte',${DEFAULT_COOLDOWN_SECONDS})
      `;
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
    let messageId: string;
    try {
      const delivered = await sendEmailVerificationEmail({
        to: email,
        restaurantName,
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
          ${sql.json({ provider: "resend", messageId })}
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
    if (
      String(error).includes("EMAIL_EXISTS_VERIFIED")
      || String(error).includes("staff_users_email_key")
    ) {
      return NextResponse.json({ error: "EMAIL_EXISTS" }, { status: 409 });
    }
    console.error("SIGNUP_FAILED", { code: safeErrorCode(error, "SIGNUP_FAILED") });
    return NextResponse.json({ error: "SIGNUP_FAILED" }, { status: 500 });
  }
}

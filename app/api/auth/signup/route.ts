import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { databaseConfigured, sql } from "@/lib/db";
import { id } from "@/lib/ids";
import { signSession, sessionCookie } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security";
import { isEmail } from "@/lib/input";
import { billingEnabled, createCheckoutSession, createTrialSubscription, isBillingInterval } from "@/lib/billing";

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
  const billingInterval = isBillingInterval(body.billingInterval) ? body.billingInterval : "monthly";
  if (restaurantName.length < 2 || !isEmail(email) || password.length < 8) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const baseSlug = slugify(restaurantName) || "commerce";
  const slug = `${baseSlug}-${id().slice(-4).toLowerCase()}`;
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const result = await sql.begin(async (tx) => {
      const establishment = (await tx`insert into establishments(id,slug,name) values(${id()},${slug},${restaurantName}) returning id,slug,name`)[0];
      const staff = (await tx`insert into staff_users(id,establishment_id,email,password_hash,role) values(${id()},${establishment.id},${email},${passwordHash},'OWNER') returning id,email,role,token_version`)[0];
      await tx`insert into loyalty_programs(id,establishment_id,program_name,mode,stamps_per_visit,reward_threshold,reward_label) values(${id()},${establishment.id},'Programme fidélité','STAMPS',1,10,'1 récompense offerte')`;
      const trialEndsAt = await createTrialSubscription(tx, String(establishment.id), billingInterval);
      return { establishment, staff, trialEndsAt };
    });

    const token = await signSession({
      staffId: String(result.staff.id),
      establishmentId: String(result.establishment.id),
      role: String(result.staff.role) as "OWNER" | "MANAGER" | "EMPLOYEE" | "VIEWER",
      email: String(result.staff.email),
      tokenVersion: Number(result.staff.token_version),
    });

    let checkoutUrl: string | null = null;
    if (billingEnabled()) {
      try {
        const session = await createCheckoutSession({
          establishmentId: String(result.establishment.id),
          email,
          interval: billingInterval,
          trialEndsAt: result.trialEndsAt,
        });
        checkoutUrl = session.url;
      } catch (error) {
        console.error("STRIPE_CHECKOUT_CREATE_FAILED", error);
      }
    }

    const response = NextResponse.json({ ok: true, slug: result.establishment.slug, checkoutUrl });
    response.cookies.set(sessionCookie(token));
    return response;
  } catch (error) {
    if (String(error).includes("staff_users_email_key")) return NextResponse.json({ error: "EMAIL_EXISTS" }, { status: 409 });
    // Une exception ici (schema desynchronise, base injoignable, etc.) ne doit
    // jamais remonter comme une page d'erreur Next.js sans corps JSON : le
    // client ne saurait plus rien afficher. On journalise le detail cote
    // serveur (visible dans les logs Vercel) et on renvoie un code stable.
    console.error("SIGNUP_FAILED", error);
    return NextResponse.json({ error: "SIGNUP_FAILED" }, { status: 500 });
  }
}

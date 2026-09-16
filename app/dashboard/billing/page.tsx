import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { OpenBillingPortalButton, StartCheckoutButton } from "@/components/billing-actions";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { getBillingRuntimeStatus, getSubscription, PRICE_ANNUAL_EUR_HT, PRICE_MONTHLY_EUR_HT, TRIAL_DAYS } from "@/lib/billing";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  trial: "Essai en cours",
  active: "Actif",
  past_due: "Paiement en retard",
  cancelled: "Résilié",
};

function daysUntil(date: Date) {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageProgram(session.role)) redirect("/dashboard");

  const [restaurant] = await sql`select name from establishments where id=${session.establishmentId} limit 1`;
  const subscription = await getSubscription(session.establishmentId);
  const billing = getBillingRuntimeStatus();

  const priceLabel = subscription?.billing_interval === "annual" ? `${PRICE_ANNUAL_EUR_HT} € HT / an` : `${PRICE_MONTHLY_EUR_HT} € HT / mois`;
  const trialEndsAt = subscription?.trial_ends_at ? new Date(subscription.trial_ends_at) : null;
  const status = subscription ? String(subscription.status) : "trial";
  const hasStripeCustomer = Boolean(subscription?.external_customer_id);

  return <><AppNav restaurantName={restaurant?.name}/><main className="shell page">
    <div className="section-head"><div><span className="eyebrow">Facturation</span><h2 style={{margin:"12px 0 4px"}}>Offre Fidgo</h2><p className="muted">Un seul abonnement, {priceLabel}, {TRIAL_DAYS} jours d’essai gratuit.</p></div></div>

    {!billing.configured && <section className="card"><h3>Paiement pas encore activé</h3><p className="muted" style={{marginTop:10}}>La facturation Stripe n’est pas encore configurée sur cet environnement. Ton accès reste gratuit pendant le pilote{trialEndsAt ? ` (essai jusqu’au ${trialEndsAt.toLocaleDateString("fr-FR")})` : ""}.</p></section>}

    <section className="card" style={{marginTop:18}}>
      <div className="section-head"><div><h3>Abonnement</h3><p className="muted">Commerce : {restaurant?.name}</p></div><span className={`badge ${status === "active" ? "success" : status === "past_due" ? "warning" : ""}`}>{STATUS_LABEL[status] || status}</span></div>
      {status === "trial" && trialEndsAt && <p>Essai gratuit : encore <strong>{daysUntil(trialEndsAt)} jour(s)</strong> (jusqu’au {trialEndsAt.toLocaleDateString("fr-FR")}).</p>}
      {subscription?.current_period_end && <p className="muted">Prochaine échéance : {new Date(subscription.current_period_end).toLocaleDateString("fr-FR")}</p>}
      {subscription?.cancel_at_period_end && <p className="notice">Résiliation programmée à la fin de la période en cours.</p>}

      <div style={{marginTop:16, display:"flex", gap:12}}>
        {billing.configured && !hasStripeCustomer && <StartCheckoutButton billingInterval={(subscription?.billing_interval as "monthly" | "annual") || "monthly"} label="Ajouter mon mode de paiement" />}
        {billing.configured && hasStripeCustomer && <OpenBillingPortalButton />}
      </div>
    </section>
  </main></>;
}

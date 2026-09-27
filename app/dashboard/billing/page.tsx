import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { OpenBillingPortalButton, StartCheckoutButton } from "@/components/billing-actions";
import { getSession } from "@/lib/auth";
import {
  BILLING_PLANS,
  BILLING_TRIAL_DAYS,
  offeredPlans,
  type BillingPlan,
  getBillingRuntimeStatus,
  getSubscription,
} from "@/lib/billing";
import { sql } from "@/lib/db";
import { canManageBilling } from "@/lib/loyalty";
import { billingStatusView } from "@/lib/billing-status-view";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageBilling(session.role)) redirect("/dashboard");

  const [establishment] = await sql`
    select name from establishments where id = ${session.establishmentId} limit 1
  `;
  const subscription = await getSubscription(session.establishmentId);
  const runtime = getBillingRuntimeStatus();
  const status = String(subscription?.status || "trial");
  const plan = String(subscription?.plan || "PILOT");
  const planDefinition = plan === "PILOT" ? null : BILLING_PLANS[plan as BillingPlan];
  const canSubscribe = !subscription?.external_subscription_id || status === "canceled";
  const canOpenPortal = Boolean(subscription?.external_customer_id);
  const view = billingStatusView({
    status,
    plan,
    trialEndsAt: subscription?.trial_ends_at ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    hasPortal: canOpenPortal,
    billingConfigured: runtime.configured,
  });

  return <><AppNav restaurantName={establishment?.name}/><main className="shell page">
    <div className="section-head"><div><span className="eyebrow">Facturation</span><h2 style={{margin:"12px 0 4px"}}>Abonnement Retiko</h2><p className="muted">Le pilote QR/PWA reste utilisable indépendamment de Stripe.</p></div><span className={`badge ${view.tone === "success" ? "success" : view.tone === "warning" ? "warning" : ""}`}>{view.label}</span></div>

    {!runtime.configured && <section className="card" style={{marginTop:18}}><h3>Paiement en ligne pas encore activé</h3><p className="muted" style={{marginTop:10}}>Aucun paiement ne sera demandé pour le moment. Le scanner, les cartes et le tableau de bord fonctionnent normalement.</p></section>}

    <section className="card" style={{marginTop:18}}>
      <div className="section-head"><div><h3>Situation actuelle</h3><p className="muted">Commerce : {establishment?.name}</p></div>{canOpenPortal && runtime.configured && <OpenBillingPortalButton/>}</div>
      <p><strong>{planDefinition?.label || "Pilote Retiko"}</strong>{planDefinition ? ` — ${planDefinition.priceLabel}` : ` — environ ${BILLING_TRIAL_DAYS} jours gratuits`}</p>
      {view.message && <p className={view.tone === "warning" ? "notice error" : "notice"} role={view.tone === "warning" ? "alert" : "status"} data-testid="billing-status-message">{view.message}</p>}
      {view.action === "portal" && <p className="muted" style={{marginTop:8}}>Utilise « Gérer mon abonnement » pour changer de moyen de paiement ou annuler la résiliation.</p>}
      {view.action === "subscribe" && canSubscribe && <p className="muted" style={{marginTop:8}}><a href="#offres">Voir les offres</a></p>}
    </section>

    {runtime.configured && canSubscribe && <section id="offres" style={{marginTop:18}}><div className="section-head"><div><h3>Choisir une offre</h3><p className="muted">Paiement sur une page sécurisée de notre prestataire de paiement.</p></div></div><div className="grid grid-3">
      {offeredPlans().map((key) => {
        const offer = BILLING_PLANS[key];
        return <article className="card" key={key}><h3>{offer.label}</h3><p style={{fontSize:20,fontWeight:800,margin:"12px 0 6px"}}>{offer.priceLabel}</p><p className="muted" style={{minHeight:44}}>{offer.commitment}</p><StartCheckoutButton plan={key} label={`Choisir ${offer.label}`}/></article>;
      })}
    </div></section>}

    <section className="notice" style={{marginTop:18}}><strong>Retiko ne stocke aucune donnée bancaire.</strong> Le paiement, le moyen de paiement et les justificatifs sont gérés sur les pages hébergées par Stripe.</section>
  </main></>;
}

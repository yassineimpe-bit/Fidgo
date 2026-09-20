import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { OpenBillingPortalButton, StartCheckoutButton } from "@/components/billing-actions";
import { getSession } from "@/lib/auth";
import {
  BILLING_PLANS,
  BILLING_TRIAL_DAYS,
  type BillingPlan,
  getBillingRuntimeStatus,
  getSubscription,
} from "@/lib/billing";
import { sql } from "@/lib/db";
import { canManageBilling } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  trial: "Pilote gratuit",
  active: "Actif",
  past_due: "Paiement en retard",
  canceled: "Résilié",
  unpaid: "Impayé",
};

function formatDate(value: unknown) {
  return value ? new Date(value as string | Date).toLocaleDateString("fr-FR") : null;
}

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

  return <><AppNav restaurantName={establishment?.name}/><main className="shell page">
    <div className="section-head"><div><span className="eyebrow">Facturation</span><h2 style={{margin:"12px 0 4px"}}>Abonnement Retiko</h2><p className="muted">Le pilote QR/PWA reste utilisable indépendamment de Stripe.</p></div><span className={`badge ${status === "active" ? "success" : status === "past_due" || status === "unpaid" ? "warning" : ""}`}>{STATUS_LABEL[status] || status}</span></div>

    {!runtime.configured && <section className="card" style={{marginTop:18}}><h3>Stripe désactivé</h3><p className="muted" style={{marginTop:10}}>Aucun paiement ne sera demandé sur cet environnement. Le scanner, les cartes et le dashboard métier continuent normalement.</p></section>}

    <section className="card" style={{marginTop:18}}>
      <div className="section-head"><div><h3>Situation actuelle</h3><p className="muted">Commerce : {establishment?.name}</p></div>{canOpenPortal && runtime.configured && <OpenBillingPortalButton/>}</div>
      <p><strong>{planDefinition?.label || "Pilote Retiko"}</strong>{planDefinition ? ` — ${planDefinition.priceLabel}` : ` — environ ${BILLING_TRIAL_DAYS} jours gratuits`}</p>
      {subscription?.trial_ends_at && <p className="muted">Fin du pilote/essai : {formatDate(subscription.trial_ends_at)}</p>}
      {subscription?.current_period_end && <p className="muted">Prochaine échéance : {formatDate(subscription.current_period_end)}</p>}
      {subscription?.cancel_at_period_end && <p className="notice">Résiliation programmée à la fin de la période courante.</p>}
    </section>

    {runtime.configured && canSubscribe && <section style={{marginTop:18}}><div className="section-head"><div><h3>Choisir une offre</h3><p className="muted">Le prix utilisé par Checkout est déterminé exclusivement par le serveur.</p></div></div><div className="grid grid-3">
      {(Object.keys(BILLING_PLANS) as BillingPlan[]).map((key) => {
        const offer = BILLING_PLANS[key];
        return <article className="card" key={key}><h3>{offer.label}</h3><p style={{fontSize:20,fontWeight:800,margin:"12px 0 6px"}}>{offer.priceLabel}</p><p className="muted" style={{minHeight:44}}>{offer.commitment}</p><StartCheckoutButton plan={key} label={`Choisir ${offer.label}`}/></article>;
      })}
    </div></section>}

    <section className="notice" style={{marginTop:18}}><strong>Retiko ne stocke aucune donnée bancaire.</strong> Le paiement, le moyen de paiement et les justificatifs sont gérés sur les pages hébergées par Stripe.</section>
  </main></>;
}

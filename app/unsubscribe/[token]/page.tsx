import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UnsubscribeButton } from "@/components/unsubscribe-button";
import { sql } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

export const metadata: Metadata = { title: "Désabonnement", robots: { index: false, follow: false, noarchive: true } };
export const dynamic = "force-dynamic";

/**
 * Un GET ne désabonne jamais : les messageries et antivirus préchargent les
 * liens. La page confirme le commerce concerné puis envoie un POST.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const customerId = verifyUnsubscribeToken(token);
  if (!customerId) notFound();
  const [customer] = await sql`
    select c.marketing_consent, e.name
    from customers c join establishments e on e.id=c.establishment_id
    where c.id=${customerId} and c.deleted_at is null
  `;
  if (!customer) notFound();
  return <main className="auth-wrap"><section className="card auth-card">
    <h1>Désabonnement</h1>
    <p className="muted">Vous ne recevrez plus les offres et nouvelles de <strong>{String(customer.name)}</strong> par e-mail. Votre carte de fidélité et votre solde ne changent pas.</p>
    <UnsubscribeButton token={token} alreadyUnsubscribed={customer.marketing_consent !== true}/>
  </section></main>;
}

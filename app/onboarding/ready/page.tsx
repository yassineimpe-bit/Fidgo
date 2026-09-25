import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Fin de l'onboarding : le parcours recommandé pour vérifier soi-même, en
 * quelques minutes, que le QR, la carte et le scanner fonctionnent. Les
 * étapes « carte test » et « premier crédit » se cochent d'après la base.
 */
export default async function OnboardingReadyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER") redirect(session.role === "EMPLOYEE" ? "/s" : "/dashboard");
  const [restaurant] = await sql`select slug,onboarding_step from establishments where id=${session.establishmentId}`;
  if (!restaurant) redirect("/dashboard");
  // Pas d'écran final tant que l'étape 4 n'a pas réellement été enregistrée.
  if (restaurant.onboarding_step !== null && Number(restaurant.onboarding_step) < 5) redirect("/onboarding");
  const [progress] = await sql`
    select
      exists(select 1 from customers where establishment_id=${session.establishmentId} and deleted_at is null) as has_card,
      exists(select 1 from transactions where establishment_id=${session.establishmentId} and type='earn') as has_credit
  `;
  const joinUrl = `${getAppUrl() || "http://localhost:3000"}/j/${restaurant.slug}`;
  const done = (value: unknown) => value === true ? <span className="ready-done" aria-label="fait">✓</span> : null;

  return <main className="shell page onboarding-shell">
    <Link href="/" className="eyebrow">Retiko</Link>
    <h1>Tout est prêt</h1>
    <p className="muted">Ton programme est en place. Fais ce test une fois toi-même avant ton premier client : il prend deux minutes.</p>
    <ol className="card ready-path" aria-label="Parcours recommandé">
      <li>
        <strong>Ouvrir l’inscription client</strong>
        <a href={joinUrl} target="_blank" rel="noopener noreferrer" style={{overflowWrap:"anywhere"}}>Ouvrir l’inscription client</a>
      </li>
      <li><strong>Créer une carte test{done(progress?.has_card)}</strong><span className="muted">Inscris-toi comme un client, avec ton e-mail.</span></li>
      <li><strong>Ouvrir le scanner</strong><Link href="/s">Ouvrir le scanner</Link></li>
      <li><strong>Scanner la carte</strong><span className="muted">Présente le QR de ta carte test à la caméra.</span></li>
      <li><strong>Ajouter le premier tampon / crédit{done(progress?.has_credit)}</strong></li>
      <li><strong>Aller au dashboard</strong><Link className="btn btn-primary" href="/dashboard">Aller au dashboard</Link></li>
    </ol>
  </main>;
}

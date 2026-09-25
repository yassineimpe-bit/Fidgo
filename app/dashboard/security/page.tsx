import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ChangePasswordForm } from "@/components/change-password-form";
import { MarketingPreference } from "@/components/marketing-preference";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export default async function SecurityPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [restaurant] = await sql`
    select name from establishments where id=${session.establishmentId} limit 1
  `;
  const [staff] = await sql`
    select marketing_consent from staff_users
    where id=${session.staffId} and establishment_id=${session.establishmentId} limit 1
  `;

  return <>
    <AppNav restaurantName={String(restaurant?.name || "Retiko")}/>
    <main className="shell page">
      <div className="section-head">
        <div>
          <span className="eyebrow">Compte</span>
          <h2 style={{margin:"12px 0 4px"}}>Sécurité</h2>
          <p className="muted">Compte connecté : {session.email}</p>
        </div>
      </div>
      <section className="card" style={{maxWidth:640}}>
        <h3>Changer le mot de passe</h3>
        <p className="muted">La modification révoque toutes les sessions existantes de ce compte.</p>
        <ChangePasswordForm/>
      </section>
      <section className="card" style={{maxWidth:640,marginTop:18}}>
        <h3>Communications Retiko</h3>
        <MarketingPreference initialConsent={staff?.marketing_consent === true}/>
      </section>
    </main>
  </>;
}

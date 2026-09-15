import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppNav } from "@/components/app-nav";
import { ChangePasswordForm } from "@/components/change-password-form";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [restaurant] = await sql`select name from establishments where id = ${session.establishmentId}`;

  return <><AppNav restaurantName={restaurant?.name}/><main className="shell page">
    <div className="section-head"><div><h2>Mon compte</h2><p className="muted">{session.email} · {session.role}</p></div></div>
    <section className="card" style={{maxWidth:420}}>
      <h3 style={{marginTop:0}}>Changer mon mot de passe</h3>
      <ChangePasswordForm/>
    </section>
  </main></>;
}

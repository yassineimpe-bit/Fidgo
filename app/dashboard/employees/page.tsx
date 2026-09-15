import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageStaff } from "@/lib/loyalty";
import { AppNav } from "@/components/app-nav";
import { EmployeeManager } from "@/components/employee-manager";

export default async function EmployeesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageStaff(session.role)) redirect("/dashboard");
  const [restaurant] = await sql`select name from establishments where id = ${session.establishmentId}`;
  const employees = await sql`select id,email,role,active,created_at from staff_users where establishment_id=${session.establishmentId} order by created_at`;
  return <><AppNav restaurantName={restaurant.name}/><main className="shell page"><div className="section-head"><div><h2>Équipe</h2><p className="muted">Accès séparés pour éviter le mot de passe commun collé sur un Post-it, cette institution mondiale de la cybersécurité.</p></div></div><EmployeeManager initial={employees as Array<{ id:string; email:string; role:string; active:boolean; created_at:string }>}/></main></>;
}

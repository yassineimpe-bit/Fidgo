import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageStaff, type StaffRole } from "@/lib/loyalty";
import { AppNav } from "@/components/app-nav";
import { EmployeeManager } from "@/components/employee-manager";
type Employee={id:string;email:string;role:StaffRole;active:boolean;created_at:string};
export default async function EmployeesPage(){const session=await getSession();if(!session)redirect("/login");if(!canManageStaff(session.role))redirect("/dashboard");const [restaurant]=await sql`select name from establishments where id=${session.establishmentId}`;const rows=await sql`select id,email,role,active,created_at from staff_users where establishment_id=${session.establishmentId} order by created_at`;const employees:Employee[]=rows.map(row=>({id:String(row.id),email:String(row.email),role:String(row.role) as StaffRole,active:Boolean(row.active),created_at:String(row.created_at)}));return <><AppNav restaurantName={String(restaurant.name)}/><main className="shell page"><div className="section-head"><div><h2>Équipe</h2><p className="muted">Accès séparés pour le poste caisse.</p></div></div><EmployeeManager initial={employees}/></main></>}

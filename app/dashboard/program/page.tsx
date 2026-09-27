import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppNav } from "@/components/app-nav";
import { canManageProgram } from "@/lib/loyalty";
import { ProgramForm, type Program } from "@/components/program-form";
export default async function ProgramPage(){const s=await getSession();if(!s)redirect("/login");if(!canManageProgram(s.role))redirect(s.role==="EMPLOYEE"?"/s":"/dashboard");const [r]=await sql`select name from establishments where id=${s.establishmentId}`;const [p]=await sql`select * from loyalty_programs where establishment_id=${s.establishmentId}`;const program=p as unknown as Program;return <><AppNav restaurantName={String(r.name)}/><main className="shell page"><div className="section-head"><div><h2>Programme fidélité</h2><p className="muted">Définis les règles de ton programme de fidélité. Les réglages avancés sont regroupés plus bas.</p></div></div><section className="card"><ProgramForm program={program}/></section></main></>}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { AppNav } from "@/components/app-nav";
import { ProgramForm } from "@/components/program-form";
export default async function ProgramPage(){const s=await getSession();if(!s)redirect("/login");const [r]=await sql`select name from establishments where id=${s.establishmentId}`;const [p]=await sql`select * from loyalty_programs where establishment_id=${s.establishmentId}`;return <><AppNav restaurantName={r.name}/><main className="shell page"><div className="section-head"><div><h2>Programme fidélité</h2><p className="muted">Le réglage qui doit rester compréhensible sans manuel de 47 pages.</p></div></div><section className="card"><ProgramForm program={p}/></section></main></>}

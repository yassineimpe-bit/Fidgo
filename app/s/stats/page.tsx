import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ScanStats } from "@/components/scan-stats";
export default async function StatsPage(){const s=await getSession();if(!s)redirect("/login");return <main className="shell page"><div className="section-head"><div><h2>Latence scanner</h2><p className="muted">Mesures terrain du poste de caisse.</p></div><a className="btn btn-primary" href="/s">Retour scanner</a></div><ScanStats/></main>}

import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { JoinForm } from "@/components/join-form";
import { cardRecoveryEnabled } from "@/lib/card-recovery";

export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [restaurant] = await sql`
    select e.name,e.logo_url,e.primary_color,p.program_name,p.mode,p.reward_threshold,p.reward_label
    from establishments e
    join loyalty_programs p on p.establishment_id=e.id
    where e.slug=${slug} and e.status='active' and p.active=true
  `;
  if (!restaurant) notFound();

  return <main className="auth-wrap" style={{background:`linear-gradient(160deg, ${restaurant.primary_color}18, #f5f6f8 55%)`}}>
    <section className="card auth-card">
      {restaurant.logo_url&&<img src={restaurant.logo_url} alt="" style={{width:64,height:64,objectFit:"contain",borderRadius:14}}/>}
      <span className="eyebrow" style={{marginTop:12}}>{restaurant.mode==="STAMPS"?"Carte à tampons":"Carte à points"}</span>
      <h2 style={{margin:"14px 0 6px"}}>{restaurant.name}</h2>
      <p className="muted">{restaurant.program_name} · {restaurant.reward_threshold} unités = {restaurant.reward_label}</p>
      <JoinForm slug={slug} recoveryEnabled={cardRecoveryEnabled()}/>
    </section>
  </main>;
}

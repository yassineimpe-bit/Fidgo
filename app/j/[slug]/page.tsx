import { notFound } from "next/navigation";
import { normalizeHexColor } from "@/lib/brand-color";
import { sql } from "@/lib/db";
import Link from "next/link";
import { JoinForm } from "@/components/join-form";
import { LEGAL_LINKS } from "@/lib/legal";
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

  // La page /c/{token} normalisait deja ses valeurs de marque, pas celle-ci :
  // la couleur partait brute dans une chaine CSS et le logo dans un <img src>
  // sans verification de schema. La validation cote ecriture ne couvre pas les
  // lignes creees avant son ajout (cf. migration 014).
  const brandColor = normalizeHexColor(restaurant.primary_color, "#111111");
  const logoUrl = typeof restaurant.logo_url === "string" && /^https:\/\//i.test(restaurant.logo_url)
    ? restaurant.logo_url
    : null;

  return <main className="auth-wrap join-page" style={{backgroundColor:`${brandColor}12`}}>
    <section className="card auth-card join-card">
      {logoUrl&&<img src={logoUrl} alt="" style={{width:64,height:64,objectFit:"contain",borderRadius:14}}/>}
      <span className="eyebrow" style={{marginTop:12}}>{restaurant.mode==="STAMPS"?"Carte à tampons":"Carte à points"}</span>
      <h2 style={{margin:"14px 0 6px"}}>{restaurant.name}</h2>
      <p className="muted">{restaurant.program_name} · {restaurant.reward_threshold} unités = {restaurant.reward_label}</p>
      <JoinForm slug={slug} recoveryEnabled={cardRecoveryEnabled()}/>
      <p className="muted legal-hint" style={{marginTop:14}}>Tes données sont utilisées par {restaurant.name} pour son programme de fidélité, avec Retiko comme prestataire technique. <Link href={LEGAL_LINKS.privacy}>Données personnelles</Link></p>
    </section>
  </main>;
}

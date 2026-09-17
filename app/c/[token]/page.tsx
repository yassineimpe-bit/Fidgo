import { notFound } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";
import { contrastTextColor, normalizeHexColor } from "@/lib/brand-color";
import { sql } from "@/lib/db";
import { parseCardToken } from "@/lib/loyalty";
import { getWalletRuntimeStatus } from "@/lib/wallet-status";
import { CardLiveStatus } from "@/components/card-live-status";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: input } = await params;
  const token = parseCardToken(input);
  if (!token) notFound();
  const [card] = await sql`
    select c.token,c.short_code,c.balance,c.updated_at,c.expires_at,e.name,e.logo_url,e.primary_color,
      p.program_name,p.mode,p.reward_threshold,p.reward_label,p.card_message,u.first_name
    from cards c
    join establishments e on e.id=c.establishment_id
    join loyalty_programs p on p.establishment_id=e.id
    join customers u on u.id=c.customer_id
    where c.token=${token} and c.active=true and e.status='active' and p.active=true and u.deleted_at is null
  `;
  if (!card) notFound();
  if (card.expires_at && new Date(card.expires_at) < new Date()) notFound();

  const qr = await QRCode.toDataURL(`LOY1:${card.token}`, { width: 420, margin: 1, errorCorrectionLevel: "M" });
  const wallet = getWalletRuntimeStatus();
  const walletHttps = wallet.appUrlConfigured && wallet.appUrlHttps;
  const appleEnabled = walletHttps && wallet.apple.configured;
  const googleEnabled = walletHttps && wallet.google.configured;
  // Un commerçant peut choisir une couleur claire (blanc, jaune pâle...) :
  // .loyalty-card impose color:white par défaut, ce qui rendrait alors le
  // texte illisible sur son propre fond. On recalcule systématiquement.
  const brandColor = normalizeHexColor(card.primary_color, "#111111");
  const brandTextColor = contrastTextColor(brandColor);

  return <main className="auth-wrap"><section style={{width:"min(480px,100%)"}}>
    <div className="loyalty-card" style={{background:brandColor,color:brandTextColor}}>
      <div><div style={{display:"flex",alignItems:"center",gap:12}}>{card.logo_url&&<Image src={String(card.logo_url)} alt={`Logo ${card.name}`} width={52} height={52} unoptimized style={{objectFit:"contain",borderRadius:12,background:"white"}}/>}<div><strong style={{fontSize:22}}>{card.name}</strong><div style={{opacity:.8}}>{card.program_name}</div></div></div>
      <div style={{marginTop:30}}><CardLiveStatus token={String(card.token)} initialBalance={Number(card.balance)} initialThreshold={Number(card.reward_threshold)} initialUpdatedAt={new Date(card.updated_at).toISOString()} mode={card.mode === "POINTS" ? "POINTS" : "STAMPS"} rewardLabel={String(card.reward_label)}/></div></div>
      <div style={{display:"grid",placeItems:"center",gap:10}}><Image className="qr" src={qr} alt="QR code fidélité" width={220} height={220} unoptimized/><strong style={{letterSpacing:".16em"}}>{card.short_code}</strong></div>
      <div><strong>{card.reward_label}</strong>{card.card_message&&<p style={{margin:"8px 0 0",opacity:.8}}>{card.card_message}</p>}</div>
    </div>
    <div className="card" style={{marginTop:14}}><h3>Ajouter au portefeuille</h3><p className="muted">La même carte et le même QR suivent ton solde dans le portefeuille du téléphone.</p><div className="grid grid-2">
      {appleEnabled ? <a className="btn btn-primary" href={`/api/wallet/apple/${card.token}`}>Ajouter à Apple Wallet</a> : <button className="btn" disabled>Apple Wallet</button>}
      {googleEnabled ? <a className="btn btn-primary" href={`/api/wallet/google/${card.token}`}>Ajouter à Google Wallet</a> : <button className="btn" disabled>Google Wallet</button>}
    </div>{(!appleEnabled||!googleEnabled)&&<p className="muted" style={{fontSize:13,marginTop:12}}>Les boutons s’activent uniquement quand HTTPS et les identifiants émetteur correspondants sont réellement prêts.</p>}</div>
  </section></main>;
}

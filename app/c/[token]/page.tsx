import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { sql } from "@/lib/db";
import { parseCardToken } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: input } = await params;
  const token = parseCardToken(input);
  if (!token) notFound();
  const [card] = await sql`
    select c.token,c.short_code,c.balance,c.expires_at,e.name,e.logo_url,e.primary_color,
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
  const percent = Math.min(100, Math.round((Number(card.balance) / Number(card.reward_threshold)) * 100));
  const appleEnabled = process.env.APPLE_WALLET_ENABLED === "true";
  const googleEnabled = process.env.GOOGLE_WALLET_ENABLED === "true";

  return <main className="auth-wrap"><section style={{width:"min(480px,100%)"}}>
    <div className="loyalty-card" style={{background:card.primary_color||"#111111"}}>
      <div><div style={{display:"flex",alignItems:"center",gap:12}}>{card.logo_url&&<img src={card.logo_url} alt="" style={{width:52,height:52,objectFit:"contain",borderRadius:12,background:"white"}}/>}<div><strong style={{fontSize:22}}>{card.name}</strong><div style={{opacity:.8}}>{card.program_name}</div></div></div>
      <div style={{marginTop:30}}><div style={{fontSize:44,fontWeight:950,letterSpacing:"-.05em"}}>{card.balance} / {card.reward_threshold}</div><div style={{opacity:.85}}>{card.mode==="STAMPS"?"tampons":"points"}</div><div className="progress" style={{marginTop:12}}><span style={{width:`${percent}%`}}/></div></div></div>
      <div style={{display:"grid",placeItems:"center",gap:10}}><img className="qr" src={qr} alt="QR code fidélité"/><strong style={{letterSpacing:".16em"}}>{card.short_code}</strong></div>
      <div><strong>{Number(card.balance)>=Number(card.reward_threshold)?`Récompense disponible : ${card.reward_label}`:card.reward_label}</strong>{card.card_message&&<p style={{margin:"8px 0 0",opacity:.8}}>{card.card_message}</p>}</div>
    </div>
    <div className="card" style={{marginTop:14}}><h3>Ajouter au portefeuille</h3><p className="muted">La même carte et le même QR suivent ton solde dans le portefeuille du téléphone.</p><div className="grid grid-2">
      {appleEnabled ? <a className="btn btn-primary" href={`/api/wallet/apple/${card.token}`}>Ajouter à Apple Wallet</a> : <button className="btn" disabled>Apple Wallet</button>}
      {googleEnabled ? <a className="btn btn-primary" href={`/api/wallet/google/${card.token}`}>Ajouter à Google Wallet</a> : <button className="btn" disabled>Google Wallet</button>}
    </div>{(!appleEnabled||!googleEnabled)&&<p className="muted" style={{fontSize:13,marginTop:12}}>Les boutons s’activent dès que les identifiants émetteur correspondants sont configurés.</p>}</div>
  </section></main>;
}

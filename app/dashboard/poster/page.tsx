import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { PrintButton } from "@/components/print-button";
export default async function PosterPage(){const s=await getSession();if(!s)redirect("/login");const [r]=await sql`select name,slug,logo_url from establishments where id=${s.establishmentId}`;const base=process.env.NEXT_PUBLIC_APP_URL||"http://localhost:3000";const url=`${base.replace(/\/$/,"")}/j/${r.slug}`;const qr=await QRCode.toDataURL(url,{width:900,margin:1,errorCorrectionLevel:"M"});return <main><div className="no-print" style={{padding:16,display:"flex",justifyContent:"center",gap:10}}><a className="btn" href="/dashboard">Retour</a><PrintButton/></div><section className="poster">{r.logo_url&&<img src={r.logo_url} alt="" style={{width:110,height:110,objectFit:"contain"}}/>}<h1>Scanne et ajoute ta carte fidélité</h1><p>{r.name}</p><img src={qr} alt="QR inscription fidélité"/><p style={{fontSize:13}}>{url}</p></section></main>}

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAppUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { PrintButton } from "@/components/print-button";

export default async function PosterPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [restaurant] = await sql`select name,slug,logo_url from establishments where id=${session.establishmentId}`;
  const [program] = await sql`select reward_threshold,reward_label from loyalty_programs where establishment_id=${session.establishmentId}`;

  const base = getAppUrl() || "http://localhost:3000";
  const url = `${base}/j/${restaurant.slug}`;
  const qr = await QRCode.toDataURL(url, { width: 900, margin: 1, errorCorrectionLevel: "M" });
  const domain = new URL(base).host;

  return <main>
    <div className="no-print" style={{ padding: 16, display: "flex", justifyContent: "center", gap: 10 }}>
      <a className="btn" href="/dashboard">Retour</a>
      <PrintButton />
    </div>
    <section className="poster">
      {restaurant.logo_url && <img src={restaurant.logo_url} alt="" style={{ width: 110, height: 110, objectFit: "contain" }} />}
      <h1>Votre fidélité sur votre téléphone</h1>
      <p>{restaurant.name}</p>
      <p>{program.reward_threshold} passages = {program.reward_label}</p>
      <img src={qr} alt="QR inscription fidélité" />
      <p style={{ fontSize: 16 }}>Scannez pour créer votre carte</p>
      <p style={{ fontSize: 13 }}>{url}</p>
      <p style={{ fontSize: 12, opacity: 0.7 }}>Propulsé par Retiko · {domain}</p>
    </section>
  </main>;
}

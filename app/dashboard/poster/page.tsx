import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { PrintButton } from "@/components/print-button";

export default async function PosterPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [restaurant] = await sql`
    select e.name, e.slug, e.logo_url,
      p.mode, p.reward_threshold, p.reward_label
    from establishments e
    join loyalty_programs p on p.establishment_id = e.id
    where e.id = ${session.establishmentId}
      and p.active = true
    limit 1
  `;

  if (!restaurant) redirect("/dashboard");

  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${base.replace(/\/$/, "")}/j/${restaurant.slug}`;
  const qr = await QRCode.toDataURL(url, { width: 900, margin: 1, errorCorrectionLevel: "M" });
  const unit = restaurant.mode === "STAMPS" ? "tampons" : "points";

  return (
    <main>
      <div className="no-print" style={{ padding: 16, display: "flex", justifyContent: "center", gap: 10 }}>
        <a className="btn" href="/dashboard">Retour</a>
        <PrintButton />
      </div>
      <section className="poster">
        {restaurant.logo_url ? (
          <img
            src={String(restaurant.logo_url)}
            alt={`Logo ${restaurant.name}`}
            style={{ width: 110, height: 110, objectFit: "contain", marginBottom: 22 }}
          />
        ) : null}
        <div style={{ fontSize: "14pt", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
          Carte fidélité · {restaurant.name}
        </div>
        <h1>Scanne pour créer ta carte fidélité</h1>
        <p style={{ maxWidth: "150mm", marginBottom: "8mm" }}>
          Cumule {restaurant.reward_threshold} {unit} et profite de : <strong>{restaurant.reward_label}</strong>
        </p>
        <img src={qr} alt="QR inscription fidélité" />
        <p style={{ fontSize: "14pt", marginTop: "8mm", marginBottom: "2mm" }}>Aucune application à télécharger</p>
        <p style={{ fontSize: "10pt", color: "#666", overflowWrap: "anywhere" }}>{url}</p>
      </section>
    </main>
  );
}

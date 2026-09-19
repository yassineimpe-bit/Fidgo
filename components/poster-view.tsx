"use client";

import { CSSProperties, useState } from "react";
import { contrastTextColor, normalizeHexColor } from "@/lib/brand-color";
import { PrintButton } from "@/components/print-button";

type PosterFormat = "a4" | "a5" | "chevalet";
type PosterTemplate = "minimal" | "contrasted";

const FORMAT_LABELS: Record<PosterFormat, string> = {
  a4: "A4 · vitrine / mur",
  a5: "A5 · comptoir",
  chevalet: "Chevalet comptoir (A6)",
};

const TEMPLATE_LABELS: Record<PosterTemplate, string> = {
  minimal: "Minimal",
  contrasted: "Contrasté",
};

export function PosterView({ name, logoUrl, primaryColor, rewardThreshold, rewardLabel, unit, qr, joinUrl, domain }: {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  rewardThreshold: number;
  rewardLabel: string;
  unit: string;
  qr: string;
  joinUrl: string;
  domain: string;
}) {
  const [format, setFormat] = useState<PosterFormat>("a4");
  const [template, setTemplate] = useState<PosterTemplate>("minimal");
  const [shareMessage, setShareMessage] = useState("");

  const brandColor = normalizeHexColor(primaryColor, "#111111");
  const brandTextColor = contrastTextColor(brandColor);
  const cssVars = { "--poster-brand-color": brandColor, "--poster-text-color": brandTextColor } as CSSProperties;
  const qrFileName = `retiko-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "commerce"}-qr.png`;

  async function copyJoinUrl() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setShareMessage("Lien copié.");
    } catch {
      setShareMessage("Copie impossible sur ce navigateur. Le lien reste affiché sous l’affiche.");
    }
  }

  return <main className="poster-page">
    <div className="no-print" style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
        <a className="btn" href="/dashboard">Retour</a>
        <PrintButton />
        <a className="btn" href={qr} download={qrFileName}>Télécharger le QR</a>
        <button className="btn" type="button" onClick={copyJoinUrl}>Copier le lien</button>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <legend className="muted" style={{ width: "100%", textAlign: "center", marginBottom: 6 }}>Format</legend>
        {(Object.keys(FORMAT_LABELS) as PosterFormat[]).map((value) => (
          <button key={value} type="button" className="btn" aria-pressed={format === value} style={format === value ? { borderColor: brandColor, fontWeight: 800 } : undefined} onClick={() => setFormat(value)}>
            {FORMAT_LABELS[value]}
          </button>
        ))}
      </fieldset>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <legend className="muted" style={{ width: "100%", textAlign: "center", marginBottom: 6 }}>Style</legend>
        {(Object.keys(TEMPLATE_LABELS) as PosterTemplate[]).map((value) => (
          <button key={value} type="button" className="btn" aria-pressed={template === value} style={template === value ? { borderColor: brandColor, fontWeight: 800 } : undefined} onClick={() => setTemplate(value)}>
            {TEMPLATE_LABELS[value]}
          </button>
        ))}
      </fieldset>
      {shareMessage ? <div className="notice" role="status" aria-live="polite">{shareMessage}</div> : null}
    </div>
    <section className={`poster poster--${format} poster--${template}`} style={cssVars}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL de logo saisie par le commerçant, jamais optimisée côté serveur (pas de SSRF).
        <img
          src={logoUrl}
          alt={`Logo ${name}`}
          className="poster-logo"
          style={{ width: 110, height: 110, objectFit: "contain", marginBottom: 22 }}
        />
      ) : null}
      <div className="poster-accent" style={{ fontSize: "14pt", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
        {name}
      </div>
      <h1>Votre fidélité, directement sur votre téléphone</h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée côté serveur (qrcode), pas une image distante. */}
      <img src={qr} alt={`QR code d'inscription à la carte fidélité ${name}`} />
      <p style={{ fontSize: "14pt", marginTop: "8mm", marginBottom: "2mm" }}>Scannez pour créer votre carte</p>
      <p style={{ maxWidth: "150mm" }}>
        {rewardThreshold} {unit} = <strong>{rewardLabel}</strong>
      </p>
      <p className="poster-footer" style={{ fontSize: "9pt", opacity: 0.65, marginTop: "6mm" }}>Propulsé par Retiko · {domain}</p>
      <p className="no-print muted" style={{ fontSize: 12, marginTop: 8, overflowWrap: "anywhere" }}>{joinUrl}</p>
    </section>
  </main>;
}

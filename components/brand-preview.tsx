"use client";

import { contrastTextColor, normalizeHexColor } from "@/lib/brand-color";

export type BrandPreviewProps = {
  name: string;
  logoUrl: string;
  primaryColor: string;
  rewardThreshold: number;
  rewardLabel: string;
  unit: string;
  qr: string;
};

/**
 * Rendu partagé entre les paramètres commerce (aperçu temps réel) et
 * l'affiche imprimable : mêmes règles de couleur/contraste, pour que ce que
 * le commerçant voit dans ses réglages ressemble à ce qu'il imprimera.
 */
export function BrandPreview({ name, logoUrl, primaryColor, rewardThreshold, rewardLabel, unit, qr }: BrandPreviewProps) {
  const brandColor = normalizeHexColor(primaryColor, "#111111");
  const textColor = contrastTextColor(brandColor);

  return <div
    aria-label="Aperçu de la carte fidélité"
    style={{
      background: brandColor,
      color: textColor,
      borderRadius: 20,
      padding: "20px 18px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 12,
      textAlign: "center",
      maxWidth: 320,
      margin: "0 auto",
    }}
  >
    {logoUrl
      // eslint-disable-next-line @next/next/no-img-element -- aperçu client d'une URL saisie par l'utilisateur, jamais optimisée côté serveur.
      ? <img src={logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 12, background: "white" }} onError={(event) => { event.currentTarget.style.display = "none"; }} />
      : null}
    <strong style={{ fontSize: 19 }}>{name || "Nom du commerce"}</strong>
    {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée côté serveur, pas une image distante à optimiser. */}
    <img src={qr} alt="QR d'inscription" width={120} height={120} style={{ background: "white", padding: 8, borderRadius: 12 }} />
    <p style={{ margin: 0, fontSize: 14, opacity: 0.9 }}>
      {rewardThreshold} {unit} = <strong>{rewardLabel || "votre récompense"}</strong>
    </p>
  </div>;
}

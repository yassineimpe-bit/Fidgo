"use client";

import { contrastTextColor, normalizeHexColor } from "@/lib/brand-color";
import { applePassColors } from "@/lib/wallet-colors";

export type WalletPreviewsProps = {
  name: string;
  primaryColor: string;
  cardImageUrl?: string | null;
  rewardThreshold: number;
  rewardLabel: string;
  unit: string;
  qr: string;
};

/**
 * Aperçus indicatifs des passes Wallet, construits avec les mêmes règles que
 * leur génération (lib/apple-wallet.ts, lib/google-wallet.ts) : couleur
 * principale unie, logo Retiko, visuel en bannière côté Google uniquement.
 */
export function WalletPreviews({ name, primaryColor, cardImageUrl, rewardThreshold, rewardLabel, unit, qr }: WalletPreviewsProps) {
  const background = normalizeHexColor(primaryColor, "#111827");
  const apple = applePassColors(background);
  const googleText = contrastTextColor(background);
  const displayName = name || "Nom du commerce";
  const sample = Math.min(3, Math.max(0, rewardThreshold - 1));
  const unitLabel = unit.toLocaleUpperCase("fr-FR");

  return <details className="wallet-previews">
    <summary>Aperçu Apple Wallet et Google Wallet</summary>
    <ul className="wallet-previews-notes">
      <li><strong>Carte web</strong> : identique à l’aperçu ci-dessus (couleurs, dégradé, visuel, voile).</li>
      <li><strong>Apple Wallet</strong> : couleur principale unie et logo Retiko. Pas de dégradé ni de visuel. Le texte passe en noir ou en blanc selon la couleur.</li>
      <li><strong>Google Wallet</strong> : couleur principale unie, logo Retiko, et le visuel importé en bannière s’il existe. Google choisit lui-même la couleur du texte.</li>
      <li>Chaque application Wallet a sa propre mise en page : ces aperçus sont indicatifs, le rendu exact dépend du téléphone.</li>
    </ul>
    <div className="wallet-previews-grid">
      <figure className="wallet-mock" aria-label="Aperçu Apple Wallet" style={{ background: apple.backgroundColor, color: apple.foregroundColor }}>
        <figcaption className="wallet-mock-caption">Apple Wallet</figcaption>
        <div className="wallet-mock-head">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo statique déjà utilisé tel quel par le pass. */}
          <img src="/wallet-logo.png" alt="" width={28} height={28} />
          <strong>{displayName}</strong>
        </div>
        <div className="wallet-mock-field"><span style={{ color: apple.labelColor }}>{unitLabel}</span><strong>{sample}</strong></div>
        <div className="wallet-mock-field"><span style={{ color: apple.labelColor }}>RÉCOMPENSE</span><strong>{rewardThreshold - sample} restant(s)</strong></div>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée côté serveur. */}
        <img className="wallet-mock-qr" src={qr} alt="" width={84} height={84} />
      </figure>
      <figure className="wallet-mock" aria-label="Aperçu Google Wallet" style={{ background, color: googleText }}>
        <figcaption className="wallet-mock-caption">Google Wallet</figcaption>
        <div className="wallet-mock-head">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo statique déjà utilisé tel quel par le pass. */}
          <img src="/wallet-logo.png" alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
          <strong>{displayName}</strong>
        </div>
        <div className="wallet-mock-field"><span>{unit.charAt(0).toLocaleUpperCase("fr-FR") + unit.slice(1)}</span><strong>{sample}/{rewardThreshold}</strong></div>
        <div className="wallet-mock-field"><span>{rewardLabel || "Récompense"}</span><strong>{rewardThreshold - sample} restant(s)</strong></div>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée côté serveur. */}
        <img className="wallet-mock-qr" src={qr} alt="" width={84} height={84} />
        {/* eslint-disable-next-line @next/next/no-img-element -- visuel déjà ré-encodé et servi par Retiko. */}
        {cardImageUrl && <img className="wallet-mock-hero" src={cardImageUrl} alt="" />}
      </figure>
    </div>
  </details>;
}

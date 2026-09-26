import type { ReactNode } from "react";
import type { ScanFeedbackTone } from "@/lib/scanner-feedback";

const PATHS: Record<ScanFeedbackTone, ReactNode> = {
  // Coche : action confirmée par le serveur.
  success: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  // Cadeau : récompense.
  reward: <><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M4 13h16M12 9v11M12 9c-2-4-6-4-6-1.5S9 9 12 9zm0 0c2-4 6-4 6-1.5S15 9 12 9z" /></>,
  // Arc tournant : requête en cours.
  pending: <path className="scan-feedback-spin" d="M12 3a9 9 0 1 0 9 9" />,
  // Horloge : délai anti double-crédit.
  cooldown: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  // Nuage barré : réseau.
  network: <><path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z" /><path d="M4 4l16 16" /></>,
  // Cadenas : session.
  session: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  // QR barré : code non reconnu.
  "invalid-qr": <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14l6 6M20 14l-6 6" /></>,
  // Carte avec point d'interrogation : carte inconnue pour ce commerce.
  "wrong-card": <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M10 10.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3M12 15.5v.01" /></>,
  // Sablier : limite de fréquence.
  limit: <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />,
  // Cercle barré : refus métier.
  refused: <><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></>,
  // Triangle d'alerte : erreur technique.
  technical: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" /></>,
  // Caméra barrée : caméra indisponible.
  camera: <><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><circle cx="12" cy="13" r="3.5" /><path d="M3 3l18 18" /></>,
};

export function ScanFeedbackIcon({ tone }: { tone: ScanFeedbackTone }) {
  return <svg className="scan-feedback-icon" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {PATHS[tone]}
  </svg>;
}

/**
 * Bandeau d'état du scanner : icône + titre + détail. La couleur n'est
 * jamais le seul indicateur, la forme de l'icône et le titre suffisent.
 */
export function ScanFeedback({ tone, title, children, live }: {
  tone: ScanFeedbackTone;
  title: string;
  children?: ReactNode;
  /** Annonce le bandeau entier aux lecteurs d'écran quand aucun enfant ne porte déjà role=alert. */
  live?: "polite" | "assertive";
}) {
  return <div className={`scan-feedback scan-feedback--${tone}`} data-tone={tone} {...(live ? { role: live === "assertive" ? "alert" : "status", "aria-live": live } : {})}>
    <ScanFeedbackIcon tone={tone} />
    <div className="scan-feedback-body">
      <strong className="scan-feedback-title">{title}</strong>
      {children}
    </div>
  </div>;
}

"use client";

import { useState } from "react";

export function CardMarketingPreference({ token, restaurantName, initialConsent, hasEmail }: { token: string; restaurantName: string; initialConsent: boolean; hasEmail: boolean }) {
  const [consent, setConsent] = useState(initialConsent);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function toggle(next: boolean) {
    // Affichage immédiat, rétabli si l'enregistrement échoue.
    setConsent(next);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/card/${encodeURIComponent(token)}/marketing`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketingConsent: next }),
      });
      if (!response.ok) {
        setConsent(!next);
        setMessage(response.status === 429 ? "Trop de modifications. Réessayez plus tard." : "Impossible d’enregistrer votre choix.");
        return;
      }
      setMessage(next ? "Vous recevrez les offres de ce commerce." : "Vous ne recevrez plus d’offres de ce commerce.");
    } catch {
      setConsent(!next);
      setMessage("Connexion perdue. Réessayez après vérification du réseau.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="card" style={{marginTop:16}}>
    <h3>Offres par e-mail</h3>
    {hasEmail
      ? <label className="check-row">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => toggle(event.target.checked)}/>
          <span>Recevoir les offres et nouvelles de {restaurantName}. Désactivable à tout moment.</span>
        </label>
      : <p className="muted">Aucune adresse e-mail n’est associée à cette carte : vous ne recevez aucun e-mail.</p>}
    {message && <p className="muted" role="status">{message}</p>}
  </div>;
}

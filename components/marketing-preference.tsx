"use client";

import { useState } from "react";

export function MarketingPreference({ initialConsent }: { initialConsent: boolean }) {
  const [consent, setConsent] = useState(initialConsent);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function toggle(next: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/marketing", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketingConsent: next }),
      });
      if (!response.ok) {
        setMessage(response.status === 429 ? "Trop de modifications. Réessaie plus tard." : "Impossible d’enregistrer ton choix.");
        return;
      }
      setConsent(next);
      setMessage(next ? "Tu recevras les nouveautés Retiko." : "Tu ne recevras plus les nouveautés Retiko.");
    } catch {
      setMessage("Connexion perdue. Réessaie après vérification du réseau.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <label className="check-row">
      <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => void toggle(event.target.checked)} />
      <span>Je souhaite recevoir par e-mail les nouveautés et offres de Retiko.</span>
    </label>
    <p className="muted">Les e-mails nécessaires au compte (vérification, sécurité, facturation) restent envoyés.</p>
    {message && <p role="status" className="notice">{message}</p>}
  </>;
}

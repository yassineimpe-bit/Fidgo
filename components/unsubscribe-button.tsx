"use client";

import { useState } from "react";

export function UnsubscribeButton({ token, alreadyUnsubscribed }: { token: string; alreadyUnsubscribed: boolean }) {
  const [done, setDone] = useState(alreadyUnsubscribed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function unsubscribe() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/unsubscribe/${encodeURIComponent(token)}`, { method: "POST" });
      if (!response.ok) { setError("Lien invalide ou service momentanément indisponible. Réessayez plus tard."); return; }
      setDone(true);
    } catch {
      setError("Connexion perdue. Vérifiez le réseau puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="notice" role="status">Vous êtes désabonné. Aucun autre e-mail promotionnel de ce commerce ne vous sera envoyé.</p>;
  return <div className="form">
    <button className="btn btn-primary" type="button" onClick={unsubscribe} disabled={busy}>{busy ? "Désabonnement…" : "Me désabonner"}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
  </div>;
}

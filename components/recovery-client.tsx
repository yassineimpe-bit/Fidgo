"use client";

import { useState } from "react";

export function RecoveryClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function recover() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/recovery/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.error === "INVALID_OR_EXPIRED_LINK") throw new Error("Ce lien a expiré ou a déjà été utilisé.");
        if (data.error === "TOO_MANY_ATTEMPTS") throw new Error("Trop de tentatives. Réessaie plus tard.");
        if (data.error === "RECOVERY_UNAVAILABLE") throw new Error("La récupération est momentanément indisponible.");
        throw new Error("Impossible de récupérer la carte pour le moment.");
      }

      const slug = String(data.slug || "");
      const cardToken = String(data.token || "");
      if (!slug || !cardToken) throw new Error("Réponse de récupération invalide.");
      localStorage.setItem(`loyalty:${slug}`, cardToken);
      window.location.assign(`/c/${encodeURIComponent(cardToken)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de récupérer la carte pour le moment.");
      setLoading(false);
    }
  }

  return <div>
    <button className="btn btn-primary" type="button" onClick={recover} disabled={loading}>
      {loading ? "Récupération…" : "Retrouver ma carte"}
    </button>
    {error ? <div className="notice error" style={{marginTop:12}}>{error}</div> : null}
    <p className="muted" style={{fontSize:13,marginTop:14}}>
      Le lien n’est consommé qu’après ce clic. Il expire après 15 minutes et ne fonctionne qu’une seule fois.
    </p>
  </div>;
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const errors: Record<string, string> = {
  STEP_NOT_READY: "Une étape précédente reste à enregistrer. Recharge la page pour la reprendre.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
};

/** Dernière étape de l'onboarding : l'équipe se crée ensuite depuis le dashboard (#151). */
export function OnboardingActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function finish() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "finish" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(errors[result.error] || "Impossible de continuer. Réessaie."); return; }
      // Ne progresse qu'après la réponse du serveur (étape réellement enregistrée).
      router.push("/onboarding/ready");
      router.refresh();
    } catch {
      setError("Connexion perdue. Ta progression est conservée ; réessaie.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="form">
    <button className="btn btn-primary" disabled={busy} onClick={finish}>{busy ? "Enregistrement…" : "Terminer la configuration"}</button>
    {error && <div className="notice error" role="alert">{error}</div>}
  </div>;
}

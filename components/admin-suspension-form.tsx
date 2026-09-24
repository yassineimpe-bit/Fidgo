"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ERRORS: Record<string, string> = {
  INVALID_INPUT: "Motif obligatoire (10 à 500 caractères, sans < ni >) et slug de confirmation requis.",
  CONFIRMATION_MISMATCH: "Le slug saisi ne correspond pas à ce commerce.",
  CANNOT_SUSPEND_OWN_ESTABLISHMENT: "Impossible de suspendre ton propre commerce : tu perdrais l’accès super-admin.",
  NOT_ACTIVE: "Ce commerce n’est plus actif.",
  NOT_PLATFORM_SUSPENDED: "Seule une suspension Retiko peut être levée ici. Une fermeture demandée par le commerçant n’est pas réversible depuis l’application.",
  RATE_LIMITED: "Trop d’actions en peu de temps. Réessaie plus tard.",
  INVALID_ORIGIN: "Requête refusée. Recharge la page.",
};

export function AdminSuspensionForm({ establishmentId, slug, mode }: { establishmentId: string; slug: string; mode: "suspend" | "reactivate" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/admin/establishments/${establishmentId}/suspension`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: mode, reason: form.get("reason"), confirmationSlug: form.get("confirmationSlug") }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(`${ERRORS[data.error] || "Action impossible pour le moment."} (${data.error || response.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Réseau indisponible. Réessaie.");
    } finally {
      setBusy(false);
    }
  }

  const label = mode === "suspend" ? "Suspendre le commerce" : "Réactiver le commerce";
  return <form className="form" onSubmit={submit} aria-label={label}>
    <p className="muted" style={{margin:0}}>
      {mode === "suspend"
        ? "Coupe immédiatement les sessions staff, le scanner, la page d’inscription et les cartes clients. Cartes, passes Wallet et comptes sont conservés : la réactivation remet tout en service."
        : "Remet le commerce en service. Les employés devront se reconnecter."}
    </p>
    <div className="field"><label htmlFor={`reason-${mode}`}>Motif (journalisé)</label><textarea className="textarea input" id={`reason-${mode}`} name="reason" required minLength={10} maxLength={500} rows={3}/></div>
    <div className="field"><label htmlFor={`slug-${mode}`}>Tape le slug <code>{slug}</code> pour confirmer</label><input className="input" id={`slug-${mode}`} name="confirmationSlug" required autoComplete="off"/></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    <button className={`btn ${mode === "suspend" ? "btn-danger" : "btn-success"}`} disabled={busy}>{busy ? "Enregistrement…" : label}</button>
  </form>;
}

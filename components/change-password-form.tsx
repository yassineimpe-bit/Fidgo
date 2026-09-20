"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CURRENT_PASSWORD: "Le mot de passe actuel est incorrect.",
  INVALID_INPUT: "Le nouveau mot de passe doit contenir au moins 8 caractères et rester compatible avec bcrypt.",
  SAME_PASSWORD: "Le nouveau mot de passe doit être différent de l’ancien.",
  PASSWORD_CHANGED_CONCURRENTLY: "Le mot de passe a changé pendant l’opération. Reconnecte-toi puis réessaie.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie plus tard.",
};

export function ChangePasswordForm() {
  const router = useRouter();
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [done,setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirmation = String(form.get("confirmation") || "");

    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error] || "Impossible de modifier le mot de passe.");
        return;
      }
      setDone(true);
      setTimeout(() => router.replace("/login"), 1500);
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <div className="notice" role="status">Mot de passe modifié. Tes sessions ont été révoquées, reconnexion en cours…</div>;
  }

  return <form className="form" onSubmit={submit}>
    <div className="field">
      <label htmlFor="current-password">Mot de passe actuel</label>
      <input className="input" id="current-password" name="currentPassword" type="password" required autoComplete="current-password" />
    </div>
    <div className="field">
      <label htmlFor="new-password">Nouveau mot de passe</label>
      <input className="input" id="new-password" name="newPassword" type="password" minLength={8} required autoComplete="new-password" />
    </div>
    <div className="field">
      <label htmlFor="new-password-confirmation">Confirmer le nouveau mot de passe</label>
      <input className="input" id="new-password-confirmation" name="confirmation" type="password" minLength={8} required autoComplete="new-password" />
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    <button className="btn btn-primary" disabled={loading}>{loading ? "Modification…" : "Modifier le mot de passe"}</button>
  </form>;
}

"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_OR_EXPIRED_LINK: "Ce lien a expiré ou a déjà été utilisé.",
  INVALID_INPUT: "Le mot de passe doit contenir au moins 8 caractères.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
  INVALID_ORIGIN: "Requête refusée. Recharge la page puis réessaie.",
  RESET_UNAVAILABLE: "La réinitialisation est momentanément indisponible.",
};

function describeError(code: string | undefined) {
  if (!code) return "Une erreur inattendue est survenue. Réessaie dans un instant.";
  return ERROR_MESSAGES[code] || "Une erreur inattendue est survenue.";
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmation") || "");
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(describeError(data.error));
        return;
      }
      setDone(true);
      setTimeout(() => router.replace("/login"), 2000);
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <div className="notice" role="status">Mot de passe mis à jour. Redirection vers la connexion…</div>;
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="reset-password">Nouveau mot de passe</label>
        <input className="input" id="reset-password" name="password" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      <div className="field">
        <label htmlFor="reset-confirmation">Confirmer le mot de passe</label>
        <input className="input" id="reset-confirmation" name="confirmation" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Validation…" : "Réinitialiser le mot de passe"}</button>
    </form>
  );
}

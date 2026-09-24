"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_OR_EXPIRED_LINK: "Ce lien a expiré, a déjà été utilisé ou a été remplacé par une inscription plus récente.",
  INVALID_CREDENTIALS: "Le mot de passe ne correspond pas à cette inscription.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
  INVALID_ORIGIN: "Requête refusée. Recharge la page puis réessaie.",
  EMAIL_VERIFICATION_UNAVAILABLE: "La vérification d’e-mail est momentanément indisponible.",
};

export function VerifyEmailForm({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password: form.get("password") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error] || "Impossible de valider cette adresse e-mail.");
        return;
      }
      router.replace("/login?verified=1");
      router.refresh();
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="muted">
        Pour empêcher qu’un tiers inscrive ton adresse à ta place, confirme aussi le mot de passe choisi lors de l’inscription.
      </p>
      <div className="field">
        <label htmlFor="verify-password">Mot de passe de l’inscription</label>
        <input className="input" id="verify-password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn btn-accent" disabled={loading}>
        {loading ? "Validation…" : "Valider mon adresse e-mail"}
      </button>
    </form>
  );
}

"use client";
import { FormEvent, useState } from "react";

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      // Le backend renvoie toujours le même statut/message, qu'un compte
      // corresponde ou non : on l'affiche tel quel, sans distinguer les cas.
      if (res.status === 400) {
        setError("Merci de vérifier l’adresse e-mail saisie.");
        return;
      }
      setSent(true);
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return <div className="notice" role="status">Si un compte correspond à cette adresse e-mail, un lien de réinitialisation vient d’être envoyé.</div>;
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="forgot-email">Email</label>
        <input className="input" id="forgot-email" name="email" type="email" required autoComplete="email" />
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Envoi…" : "Envoyer le lien de réinitialisation"}</button>
    </form>
  );
}

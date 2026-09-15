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
    const res = await fetch("/api/auth/password/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email") }),
    });
    setLoading(false);
    // La reponse reste generique que le compte existe ou non : on l'affiche
    // telle quelle, jamais de branche differente selon res.ok pour ce endpoint.
    if (res.status === 400) { setError("Adresse email invalide."); return; }
    setSent(true);
  }

  if (sent) {
    return <div className="notice">Si cette adresse est associée à un compte, un lien de réinitialisation va être envoyé. Vérifie ta boîte mail dans les prochaines minutes.</div>;
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="forgot-email">Email</label>
        <input className="input" id="forgot-email" name="email" type="email" required autoComplete="email" />
      </div>
      {error && <div className="notice error">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Envoi…" : "Envoyer le lien"}</button>
    </form>
  );
}

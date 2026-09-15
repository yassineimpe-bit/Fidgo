"use client";
import { FormEvent, useState } from "react";

export function ChangePasswordForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setDone(false);
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    const confirm = String(form.get("confirm") || "");
    if (newPassword !== confirm) { setError("Les deux mots de passe ne correspondent pas."); setLoading(false); return; }

    const res = await fetch("/api/auth/password/change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error === "INVALID_CURRENT_PASSWORD" ? "Mot de passe actuel incorrect." : data.error === "TOO_MANY_ATTEMPTS" ? "Trop de tentatives, réessaie plus tard." : "Impossible de changer le mot de passe pour le moment.");
      return;
    }
    setDone(true);
    e.currentTarget.reset();
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="current-password">Mot de passe actuel</label>
        <input className="input" id="current-password" name="currentPassword" type="password" required autoComplete="current-password" />
      </div>
      <div className="field">
        <label htmlFor="account-new-password">Nouveau mot de passe</label>
        <input className="input" id="account-new-password" name="newPassword" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      <div className="field">
        <label htmlFor="account-confirm-password">Confirmer le nouveau mot de passe</label>
        <input className="input" id="account-confirm-password" name="confirm" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      {error && <div className="notice error">{error}</div>}
      {done && <div className="notice">Mot de passe mis à jour.</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Enregistrement…" : "Changer mon mot de passe"}</button>
    </form>
  );
}

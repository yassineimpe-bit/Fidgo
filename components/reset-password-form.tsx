"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) { setError("Les deux mots de passe ne correspondent pas."); setLoading(false); return; }

    const res = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error === "INVALID_OR_EXPIRED_LINK" || data.error === "INVALID_INPUT" ? "Ce lien a expiré ou a déjà été utilisé." : "Impossible de réinitialiser le mot de passe pour le moment.");
      setLoading(false);
      return;
    }
    router.replace("/login");
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="new-password">Nouveau mot de passe</label>
        <input className="input" id="new-password" name="password" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Confirmer le mot de passe</label>
        <input className="input" id="confirm-password" name="confirm" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      {error && <div className="notice error">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Enregistrement…" : "Choisir ce mot de passe"}</button>
    </form>
  );
}

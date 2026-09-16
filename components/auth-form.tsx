"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setError("");
    const form = new FormData(e.currentTarget);
    const payload = mode === "signup"
      ? { restaurantName: form.get("restaurantName"), email: form.get("email"), password: form.get("password"), billingInterval: form.get("billingInterval") }
      : { email: form.get("email"), password: form.get("password") };
    const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || "Erreur"); setLoading(false); return; }
    if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; }
    router.replace("/dashboard"); router.refresh();
  }
  return (
    <form className="form" onSubmit={submit}>
      {mode === "signup" && <div className="field"><label htmlFor="restaurantName">Nom du commerce</label><input className="input" id="restaurantName" name="restaurantName" required maxLength={120} /></div>}
      <div className="field"><label htmlFor={`${mode}-email`}>Email</label><input className="input" id={`${mode}-email`} name="email" type="email" required autoComplete="email" /></div>
      <div className="field"><label htmlFor={`${mode}-password`}>Mot de passe</label><input className="input" id={`${mode}-password`} name="password" type="password" minLength={8} required autoComplete={mode === "signup" ? "new-password" : "current-password"} /></div>
      {mode === "signup" && <div className="field">
        <label>Offre Fidgo</label>
        <label style={{display:"flex",gap:10,alignItems:"center"}}><input type="radio" name="billingInterval" value="monthly" defaultChecked /> 29 € HT / mois, sans engagement</label>
        <label style={{display:"flex",gap:10,alignItems:"center"}}><input type="radio" name="billingInterval" value="annual" /> 290 € HT / an</label>
        <p className="muted">30 jours d’essai gratuit. Aucun prélèvement pendant l’essai.</p>
      </div>}
      {error && <div className="notice error">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Chargement…" : mode === "signup" ? "Créer mon espace" : "Se connecter"}</button>
    </form>
  );
}

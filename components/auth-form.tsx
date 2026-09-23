"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  EMAIL_EXISTS: "Un compte existe déjà avec cet email.",
  INVALID_INPUT: "Merci de vérifier les champs du formulaire.",
  INVALID_CREDENTIALS: "Email ou mot de passe incorrect.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
  INVALID_ORIGIN: "Requête refusée. Recharge la page puis réessaie.",
  SERVICE_UNAVAILABLE: "Le service de connexion n’est pas encore disponible. Réessaie un peu plus tard.",
  SIGNUP_FAILED: "Impossible de créer le compte pour le moment.",
  LOGIN_FAILED: "Connexion impossible pour le moment.",
};

function describeError(code: string | undefined) {
  if (!code) return "Une erreur inattendue est survenue. Réessaie dans un instant.";
  return `${ERROR_MESSAGES[code] || "Une erreur inattendue est survenue."} (${code})`;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setError("");
    const form = new FormData(e.currentTarget);
    const payload = mode === "signup"
      ? { restaurantName: form.get("restaurantName"), email: form.get("email"), password: form.get("password") }
      : { email: form.get("email"), password: form.get("password") };
    try {
      const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(describeError(data.error)); return; }
      router.replace(mode === "signup" ? "/onboarding" : "/dashboard"); router.refresh();
    } catch {
      // Une perte réseau pendant l'envoi ne doit jamais laisser le bouton
      // bloqué sur "Chargement…" sans explication.
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <form className="form" onSubmit={submit}>
      {mode === "signup" && <div className="field"><label htmlFor="restaurantName">Nom du commerce</label><input className="input" id="restaurantName" name="restaurantName" required maxLength={120} /></div>}
      <div className="field"><label htmlFor={`${mode}-email`}>Email</label><input className="input" id={`${mode}-email`} name="email" type="email" required autoComplete="email" /></div>
      <div className="field"><label htmlFor={`${mode}-password`}>Mot de passe</label><input className="input" id={`${mode}-password`} name="password" type="password" minLength={8} required autoComplete={mode === "signup" ? "new-password" : "current-password"} /></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Chargement…" : mode === "signup" ? "Créer mon espace" : "Se connecter"}</button>
    </form>
  );
}

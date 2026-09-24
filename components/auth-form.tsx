"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  EMAIL_EXISTS: "Un compte vérifié existe déjà avec cet email.",
  INVALID_INPUT: "Merci de vérifier les champs du formulaire.",
  INVALID_CREDENTIALS: "Email ou mot de passe incorrect.",
  EMAIL_NOT_VERIFIED: "Cette adresse e-mail doit être vérifiée avant la connexion.",
  EMAIL_VERIFICATION_UNAVAILABLE: "La vérification d’e-mail est momentanément indisponible.",
  EMAIL_VERIFICATION_SEND_FAILED: "Le compte est créé, mais l’e-mail de vérification n’a pas pu être envoyé.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
  INVALID_ORIGIN: "Requête refusée. Recharge la page puis réessaie.",
  SERVICE_UNAVAILABLE: "Le service de connexion n’est pas encore disponible. Réessaie un peu plus tard.",
  SIGNUP_FAILED: "Impossible de créer le compte pour le moment.",
  LOGIN_FAILED: "Connexion impossible pour le moment.",
  ESTABLISHMENT_SUSPENDED: "Ce commerce est suspendu. Contacte le support Retiko pour le réactiver.",
};

function describeError(code: string | undefined) {
  if (!code) return "Une erreur inattendue est survenue. Réessaie dans un instant.";
  return `${ERROR_MESSAGES[code] || "Une erreur inattendue est survenue."} (${code})`;
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationPending, setVerificationPending] = useState<"sent" | "failed" | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [loginNeedsVerification, setLoginNeedsVerification] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setLoginNeedsVerification(false);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const payload = mode === "signup"
      ? { restaurantName: form.get("restaurantName"), email, password: form.get("password") }
      : { email, password: form.get("password") };

    try {
      const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (mode === "signup" && data.error === "EMAIL_VERIFICATION_SEND_FAILED" && data.accountCreated) {
          setPendingEmail(email);
          setVerificationPending("failed");
          return;
        }
        if (mode === "login" && data.error === "EMAIL_NOT_VERIFIED") {
          setLoginNeedsVerification(true);
        }
        setError(describeError(data.error));
        return;
      }

      if (mode === "signup" && data.verificationRequired) {
        setPendingEmail(email);
        setVerificationPending("sent");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "signup" && verificationPending) {
    return <div className="form">
      <div className={verificationPending === "failed" ? "notice error" : "notice"} role="status">
        {verificationPending === "failed"
          ? "Ton compte a bien été préparé, mais l’e-mail de vérification n’a pas pu être envoyé."
          : <>Inscription enregistrée. Un e-mail de vérification a été envoyé à <strong>{pendingEmail}</strong>.</>}
      </div>
      <p className="muted">
        La connexion restera bloquée tant que l’adresse e-mail n’aura pas été confirmée. Le lien demandera aussi le mot de passe choisi ici.
      </p>
      <Link className="btn btn-primary" href="/verify-email/resend">Renvoyer le lien de vérification</Link>
      <Link className="btn" href="/login">Retour à la connexion</Link>
    </div>;
  }

  return (
    <form className="form" onSubmit={submit}>
      {mode === "signup" && <div className="field"><label htmlFor="restaurantName">Nom du commerce</label><input className="input" id="restaurantName" name="restaurantName" required maxLength={120} /></div>}
      <div className="field"><label htmlFor={`${mode}-email`}>Email</label><input className="input" id={`${mode}-email`} name="email" type="email" required autoComplete="email" /></div>
      <div className="field"><label htmlFor={`${mode}-password`}>Mot de passe</label><input className="input" id={`${mode}-password`} name="password" type="password" minLength={8} required autoComplete={mode === "signup" ? "new-password" : "current-password"} /></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {loginNeedsVerification && <p className="muted"><Link href="/verify-email/resend"><strong>Renvoyer le lien de vérification</strong></Link></p>}
      <button className={mode === "signup" ? "btn btn-accent" : "btn btn-primary"} disabled={loading}>{loading ? "Chargement…" : mode === "signup" ? "Créer mon espace" : "Se connecter"}</button>
    </form>
  );
}

"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LEGAL_LINKS, LEGAL_VERSION } from "@/lib/legal";

const ERROR_MESSAGES: Record<string, string> = {
  EMAIL_EXISTS: "Un compte existe déjà avec cet email.",
  INVALID_INPUT: "Merci de vérifier les champs du formulaire.",
  INVALID_CREDENTIALS: "Email ou mot de passe incorrect.",
  LEGAL_ACCEPTANCE_REQUIRED: "Tu dois accepter les CGU et les CGV en vigueur pour créer le compte.",
  EMAIL_NOT_VERIFIED: "Cette adresse e-mail doit être vérifiée avant la connexion.",
  EMAIL_VERIFICATION_UNAVAILABLE: "La vérification d’e-mail est momentanément indisponible.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
  INVALID_ORIGIN: "Requête refusée. Recharge la page puis réessaie.",
  SERVICE_UNAVAILABLE: "Le service de connexion n’est pas encore disponible. Réessaie un peu plus tard.",
  SIGNUP_FAILED: "Impossible de créer le compte pour le moment.",
  LOGIN_FAILED: "Connexion impossible pour le moment.",
  ESTABLISHMENT_SUSPENDED: "Ce commerce est suspendu. Contacte le support Retiko pour le réactiver.",
  INVALID_2FA_CODE: "Code incorrect ou déjà utilisé.",
  TWO_FACTOR_EXPIRED: "La vérification a expiré. Saisis à nouveau ton mot de passe.",
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
  const [twoFactor, setTwoFactor] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  function enter(data: { onboardingPending?: boolean }) {
    router.replace(data.onboardingPending ? "/onboarding" : "/dashboard");
    router.refresh();
  }

  async function submitSecondFactor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const value = String(new FormData(e.currentTarget).get("secondFactor") || "").trim();
    try {
      const res = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(useRecoveryCode ? { recoveryCode: value } : { code: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "TWO_FACTOR_EXPIRED") setTwoFactor(false);
        setError(describeError(data.error));
        return;
      }
      enter(data);
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setLoginNeedsVerification(false);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const payload = mode === "signup"
      ? {
          restaurantName: form.get("restaurantName"),
          email,
          password: form.get("password"),
          legalAccepted: form.get("legalAccepted") === "on",
          legalVersion: LEGAL_VERSION,
          marketingOptIn: form.get("marketingOptIn") === "on",
        }
      : { email, password: form.get("password") };

    try {
      const res = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(payload),
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

      if (mode === "login" && data.twoFactorRequired) {
        setTwoFactor(true);
        setUseRecoveryCode(false);
        return;
      }

      enter(data);
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
          ? "Ton compte a bien été créé, mais l’e-mail de vérification n’a pas pu être envoyé."
          : <>Compte créé. Un e-mail de vérification a été envoyé à <strong>{pendingEmail}</strong>.</>}
      </div>
      <p className="muted">La connexion restera bloquée tant que l’adresse e-mail n’aura pas été confirmée.</p>
      <Link className="btn btn-primary" href="/verify-email/resend">Renvoyer le lien de vérification</Link>
      <Link className="btn" href="/login">Retour à la connexion</Link>
    </div>;
  }

  if (mode === "login" && twoFactor) {
    return <form className="form" onSubmit={submitSecondFactor}>
      <p className="muted">{useRecoveryCode
        ? "Saisis un de tes codes de secours. Chaque code ne fonctionne qu’une fois."
        : "Saisis le code à 6 chiffres affiché par ton application d’authentification."}</p>
      <div className="field">
        <label htmlFor="login-second-factor">{useRecoveryCode ? "Code de secours" : "Code de vérification"}</label>
        <input key={useRecoveryCode ? "recovery" : "totp"} className="input" id="login-second-factor" name="secondFactor" required autoFocus
          autoComplete={useRecoveryCode ? "off" : "one-time-code"} inputMode={useRecoveryCode ? "text" : "numeric"}
          pattern={useRecoveryCode ? "[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}" : "[0-9]{6}"} maxLength={useRecoveryCode ? 11 : 6}
          placeholder={useRecoveryCode ? "XXXXX-XXXXX" : "123456"} />
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Vérification…" : "Vérifier"}</button>
      <button className="btn" type="button" onClick={() => { setUseRecoveryCode(!useRecoveryCode); setError(""); }}>
        {useRecoveryCode ? "Utiliser le code de l’application" : "Utiliser un code de secours"}
      </button>
    </form>;
  }

  return (
    <form className="form" onSubmit={submit}>
      {mode === "signup" && <div className="field"><label htmlFor="restaurantName">Nom du commerce</label><input className="input" id="restaurantName" name="restaurantName" required maxLength={120} /></div>}
      <div className="field"><label htmlFor={`${mode}-email`}>Email</label><input className="input" id={`${mode}-email`} name="email" type="email" required autoComplete="email" /></div>
      <div className="field"><label htmlFor={`${mode}-password`}>Mot de passe</label><input className="input" id={`${mode}-password`} name="password" type="password" minLength={8} required autoComplete={mode === "signup" ? "new-password" : "current-password"} /></div>
      {mode === "signup" && <>
        {/* Accord contractuel obligatoire, distinct du consentement marketing facultatif. */}
        <label className="check-row">
          <input name="legalAccepted" type="checkbox" required />
          <span>J’accepte les <Link href={LEGAL_LINKS.cgu} target="_blank">CGU</Link> et les <Link href={LEGAL_LINKS.cgv} target="_blank">CGV</Link> de Retiko.</span>
        </label>
        <label className="check-row">
          <input name="marketingOptIn" type="checkbox" />
          <span>Je souhaite recevoir par e-mail les nouveautés et offres de Retiko. <span className="muted">(facultatif, révocable à tout moment)</span></span>
        </label>
        <p className="muted legal-hint">Tes données sont traitées selon la <Link href={LEGAL_LINKS.privacy} target="_blank">politique de confidentialité</Link>.</p>
      </>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {loginNeedsVerification && <p className="muted"><Link href="/verify-email/resend"><strong>Renvoyer le lien de vérification</strong></Link></p>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Chargement…" : mode === "signup" ? "Créer mon espace" : "Se connecter"}</button>
    </form>
  );
}

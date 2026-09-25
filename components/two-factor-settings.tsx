"use client";

import { FormEvent, useState } from "react";

type Status = { available: boolean; enabled: boolean; recoveryCodesRemaining: number };
type Step = "idle" | "password" | "scan" | "codes" | "disable" | "regenerate";

const ERRORS: Record<string, string> = {
  INVALID_PASSWORD: "Mot de passe incorrect.",
  INVALID_2FA_CODE: "Code incorrect ou déjà utilisé. Attends le code suivant puis réessaie.",
  ALREADY_ENABLED: "La double authentification est déjà active.",
  NOT_PENDING: "La préparation a expiré. Recommence l’activation.",
  NOT_ENABLED: "La double authentification n’est pas active.",
  TWO_FACTOR_UNAVAILABLE: "La double authentification n’est pas encore disponible sur ce serveur.",
  RATE_LIMITED: "Trop de tentatives. Réessaie dans quelques minutes.",
};

async function post(body: Record<string, string>) {
  const response = await fetch("/api/account/two-factor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

export function TwoFactorSettings({ initial }: { initial: Status }) {
  const [status, setStatus] = useState(initial);
  const [step, setStep] = useState<Step>("idle");
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(event: FormEvent<HTMLFormElement>, handler: (form: FormData) => Promise<void>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await handler(new FormData(event.currentTarget));
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }

  const fail = (data: { error?: unknown }) => setMessage(ERRORS[String(data.error)] || "Opération impossible pour le moment.");

  if (!status.available) {
    return <p className="muted">La double authentification sera disponible après la prochaine mise à jour du serveur.</p>;
  }

  if (step === "codes") {
    return <div className="form">
      <div className="notice" role="status">Double authentification {status.enabled ? "active" : "prête"}. Enregistre ces codes de secours maintenant : ils ne seront plus affichés.</div>
      <ul className="recovery-codes" aria-label="Codes de secours">{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
      <p className="muted">Chaque code permet une seule connexion si tu n’as plus ton téléphone. Garde-les hors de ce téléphone (gestionnaire de mots de passe, papier rangé).</p>
      <button className="btn btn-primary" type="button" onClick={() => { setCodes([]); setStep("idle"); }}>J’ai enregistré mes codes</button>
    </div>;
  }

  if (!status.enabled) {
    if (step === "password") {
      return <form className="form" onSubmit={(event) => run(event, async (form) => {
        const { ok, data } = await post({ action: "setup", password: String(form.get("password") || "") });
        if (!ok) return fail(data);
        setSetup({ secret: String(data.secret), qr: String(data.qr) });
        setStep("scan");
      })}>
        <div className="field"><label htmlFor="two-factor-password">Mot de passe actuel</label>
          <input className="input" id="two-factor-password" name="password" type="password" required autoComplete="current-password"/></div>
        {message && <div className="notice error" role="alert">{message}</div>}
        <div className="actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? "Vérification…" : "Continuer"}</button>
          <button className="btn" type="button" onClick={() => { setStep("idle"); setMessage(""); }}>Annuler</button>
        </div>
      </form>;
    }
    if (step === "scan" && setup) {
      return <form className="form" onSubmit={(event) => run(event, async (form) => {
        const { ok, data } = await post({ action: "enable", code: String(form.get("code") || "") });
        if (!ok) return fail(data);
        setStatus({ available: true, enabled: true, recoveryCodesRemaining: data.recoveryCodes.length });
        setCodes(data.recoveryCodes);
        setSetup(null);
        setStep("codes");
      })}>
        <p>1. Scanne ce QR code avec ton application d’authentification (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL générée par le serveur. */}
        <img src={setup.qr} alt="QR code de la double authentification" width={200} height={200} style={{ background: "white", padding: 8, borderRadius: 12 }}/>
        <p className="muted">Impossible de scanner ? Saisis cette clé dans l’application : <code data-testid="two-factor-secret">{setup.secret}</code></p>
        <div className="field"><label htmlFor="two-factor-code">2. Code à 6 chiffres affiché par l’application</label>
          <input className="input" id="two-factor-code" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}/></div>
        {message && <div className="notice error" role="alert">{message}</div>}
        <div className="actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? "Activation…" : "Activer la double authentification"}</button>
          <button className="btn" type="button" onClick={() => { setStep("idle"); setSetup(null); setMessage(""); }}>Annuler</button>
        </div>
      </form>;
    }
    return <div className="form">
      {message && <div className="notice" role="status">{message}</div>}
      <p className="muted">Désactivée. Une fois activée, un code de ton téléphone sera demandé à chaque connexion en plus du mot de passe.</p>
      <button className="btn btn-primary" type="button" onClick={() => setStep("password")}>Activer la double authentification</button>
    </div>;
  }

  if (step === "disable" || step === "regenerate") {
    const disable = step === "disable";
    return <form className="form" onSubmit={(event) => run(event, async (form) => {
      const value = String(form.get("factor") || "").trim();
      const factor: Record<string, string> = /^\d{6}$/.test(value) ? { code: value } : { recoveryCode: value };
      const { ok, data } = await post(disable
        ? { action: "disable", password: String(form.get("password") || ""), ...factor }
        : { action: "regenerate", ...factor });
      if (!ok) return fail(data);
      if (disable) {
        setStatus({ available: true, enabled: false, recoveryCodesRemaining: 0 });
        setStep("idle");
        setMessage("Double authentification désactivée.");
        return;
      }
      setStatus({ ...status, recoveryCodesRemaining: data.recoveryCodes.length });
      setCodes(data.recoveryCodes);
      setStep("codes");
    })}>
      {disable && <div className="field"><label htmlFor="two-factor-disable-password">Mot de passe actuel</label>
        <input className="input" id="two-factor-disable-password" name="password" type="password" required autoComplete="current-password"/></div>}
      <div className="field"><label htmlFor="two-factor-factor">Code de l’application ou code de secours</label>
        <input className="input" id="two-factor-factor" name="factor" required autoComplete="one-time-code" maxLength={11}/></div>
      {message && <div className="notice error" role="alert">{message}</div>}
      <div className="actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Vérification…" : disable ? "Désactiver" : "Générer de nouveaux codes"}</button>
        <button className="btn" type="button" onClick={() => { setStep("idle"); setMessage(""); }}>Annuler</button>
      </div>
    </form>;
  }

  return <div className="form">
    <p><strong>Active.</strong> Un code de ton application est demandé à chaque connexion.</p>
    <p className="muted">Codes de secours restants : {status.recoveryCodesRemaining}</p>
    {message && <div className="notice" role="status">{message}</div>}
    <div className="actions">
      <button className="btn" type="button" onClick={() => { setStep("regenerate"); setMessage(""); }}>Régénérer les codes de secours</button>
      <button className="btn" type="button" onClick={() => { setStep("disable"); setMessage(""); }}>Désactiver</button>
    </div>
  </div>;
}

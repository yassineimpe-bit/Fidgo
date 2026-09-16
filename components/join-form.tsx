"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function JoinForm({ slug, recoveryEnabled = false }: { slug: string; recoveryEnabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");

  useEffect(() => {
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventType: "JOIN_PAGE_VIEW", slug }),
    }).catch(() => undefined);
    const token = localStorage.getItem(`loyalty:${slug}`);
    if (token) router.replace(`/c/${token}`);
  }, [slug, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setRecoveryEmail("");
    setRecoveryMessage("");

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();

    try {
      const response = await fetch("/api/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          firstName: form.get("firstName") || null,
          email: email || null,
          phone: form.get("phone") || null,
          marketingConsent: form.get("consent") === "on",
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.error === "CARD_ALREADY_EXISTS") {
          if (recoveryEnabled && email) {
            setRecoveryEmail(email);
            setError("Une carte existe déjà pour ces coordonnées. Tu peux recevoir un lien sécurisé pour la retrouver.");
          } else if (recoveryEnabled) {
            setError("Une carte existe déjà pour ces coordonnées. Saisis l’email utilisé sur la carte pour la récupérer, ou demande-la en caisse.");
          } else {
            setError("Une carte existe déjà pour ces coordonnées. Demande-la en caisse avec ton code court ou ton email.");
          }
          return;
        }
        if (data.error === "RATE_LIMITED") {
          setError("Trop de tentatives. Réessaie plus tard.");
          return;
        }
        setError("Impossible de créer la carte pour le moment.");
        return;
      }

      localStorage.setItem(`loyalty:${slug}`, String(data.token));
      router.push(`/c/${data.token}`);
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestRecovery() {
    if (!recoveryEnabled || !recoveryEmail || recoveryLoading) return;
    setRecoveryLoading(true);
    setRecoveryMessage("");
    try {
      const response = await fetch("/api/recovery/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, email: recoveryEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRecoveryMessage("Impossible d’envoyer le lien pour le moment. Réessaie plus tard.");
        return;
      }
      setRecoveryMessage(data.message || "Si une carte correspond à cette adresse, un lien valable 15 minutes va être envoyé.");
    } catch {
      setRecoveryMessage("Connexion impossible. Réessaie quand le réseau est revenu.");
    } finally {
      setRecoveryLoading(false);
    }
  }

  return <form className="form" onSubmit={submit}>
    <div className="field">
      <label htmlFor="join-first-name">Prénom <span className="muted">(facultatif)</span></label>
      <input className="input" id="join-first-name" name="firstName" autoComplete="given-name"/>
    </div>
    <div className="field">
      <label htmlFor="join-email">Email</label>
      <input className="input" id="join-email" name="email" type="email" required autoComplete="email"/>
    </div>
    <div className="field">
      <label htmlFor="join-phone">Téléphone <span className="muted">(facultatif)</span></label>
      <input className="input" id="join-phone" name="phone" type="tel" autoComplete="tel"/>
    </div>
    <label style={{display:"flex",gap:10,alignItems:"flex-start"}}>
      <input type="checkbox" name="consent" style={{marginTop:4}}/>
      <span>J’accepte de recevoir les offres et actualités de ce commerce. Je peux me désinscrire à tout moment.</span>
    </label>
    {error ? <div className="notice error">{error}</div> : null}
    {recoveryEnabled && recoveryEmail ? <button className="btn" type="button" onClick={requestRecovery} disabled={recoveryLoading}>
      {recoveryLoading ? "Envoi…" : "M’envoyer un lien de récupération"}
    </button> : null}
    {recoveryMessage ? <div className="notice">{recoveryMessage}</div> : null}
    <button className="btn btn-primary" disabled={submitting}>{submitting ? "Création…" : "Créer ma carte"}</button>
    <p className="muted" style={{fontSize:13}}>L’email sert à retrouver ta carte. Le téléphone reste facultatif. Le consentement marketing est séparé de la création de la carte.</p>
  </form>;
}

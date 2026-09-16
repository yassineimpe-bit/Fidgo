"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const RECOVERY_MESSAGE = "Si cette adresse est associée à une carte, vous allez recevoir un lien pour la retrouver.";

export function JoinForm({ slug, recoveryEnabled = false }: { slug: string; recoveryEnabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
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

  async function requestRecovery(email: string) {
    if (!recoveryEnabled || !email || recoveryLoading) return;
    setRecoveryLoading(true);
    setRecoveryMessage(RECOVERY_MESSAGE);
    try {
      await fetch("/api/recovery/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, email }),
      });
    } catch {
      // Le message public reste volontairement identique : une panne réseau ou
      // l'existence d'une carte ne doit pas devenir un oracle d'énumération.
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
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
          email,
          phone: form.get("phone") || null,
          marketingConsent: form.get("consent") === "on",
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.error === "CARD_ALREADY_EXISTS") {
          if (recoveryEnabled) {
            await requestRecovery(email);
          } else {
            setError(RECOVERY_MESSAGE);
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

  return <form className="form" onSubmit={submit}>
    <div className="field">
      <label htmlFor="join-first-name">Prénom <span className="muted">(facultatif)</span></label>
      <input className="input" id="join-first-name" name="firstName" autoComplete="given-name"/>
    </div>
    <div className="field">
      <label htmlFor="join-email">Email</label>
      <input className="input" id="join-email" name="email" type="email" autoComplete="email" required/>
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
    {recoveryMessage ? <div className="notice">{recoveryMessage}{recoveryLoading ? " Envoi en cours…" : ""}</div> : null}
    <button className="btn btn-primary" disabled={submitting}>{submitting ? "Création…" : "Créer ma carte"}</button>
    <p className="muted" style={{fontSize:13}}>L’email est nécessaire pour retrouver la carte en cas de perte. Le téléphone reste facultatif et le consentement marketing est séparé de la création de la carte.</p>
  </form>;
}

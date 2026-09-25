"use client";

import { useState } from "react";

type Contact = { firstName: string; email: string; phone: string; marketingConsent: boolean };

const ERRORS: Record<string, string> = {
  INVALID_INPUT: "Coordonnées invalides : vérifie l’e-mail et le téléphone.",
  CONTACT_ALREADY_USED: "Cet e-mail ou ce téléphone est déjà utilisé par un autre client.",
  RATE_LIMITED: "Trop de modifications. Réessaie dans quelques minutes.",
};

export function CustomerContact({ customerId, initial, canEdit }: { customerId: string; initial: Contact; canEdit: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const { error } = await response.json().catch(() => ({ error: "" }));
        setMessage(ERRORS[String(error)] || "Impossible d’enregistrer la modification.");
        return false;
      }
      setMessage(done);
      return true;
    } catch {
      setMessage("Connexion perdue. Réessaie après vérification du réseau.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveContact() {
    const next = { ...draft, firstName: draft.firstName.trim(), email: draft.email.trim().toLowerCase(), phone: draft.phone.trim() };
    if (await send({ firstName: next.firstName, email: next.email, phone: next.phone }, "Coordonnées rectifiées.")) {
      setSaved({ ...saved, firstName: next.firstName, email: next.email, phone: next.phone });
      setDraft({ ...draft, ...next });
    }
  }

  async function withdrawMarketing() {
    if (!window.confirm("Retirer le consentement marketing de ce client ? Seul le client pourra consentir à nouveau.")) return;
    if (await send({ marketingConsent: false }, "Consentement marketing retiré.")) {
      setSaved({ ...saved, marketingConsent: false });
      setDraft({ ...draft, marketingConsent: false });
    }
  }

  const dirty = draft.firstName !== saved.firstName || draft.email !== saved.email || draft.phone !== saved.phone;

  return <div className="card">
    <h3>Profil</h3>
    {canEdit ? <form onSubmit={(event) => { event.preventDefault(); void saveContact(); }}>
      <label htmlFor="customer-first-name">Prénom</label>
      <input id="customer-first-name" className="input" maxLength={80} value={draft.firstName}
        onChange={(event) => { setDraft({ ...draft, firstName: event.target.value }); setMessage(""); }} />
      <label htmlFor="customer-email">E-mail</label>
      <input id="customer-email" className="input" type="email" required maxLength={254} value={draft.email}
        onChange={(event) => { setDraft({ ...draft, email: event.target.value }); setMessage(""); }} />
      <label htmlFor="customer-phone">Téléphone</label>
      <input id="customer-phone" className="input" type="tel" maxLength={40} value={draft.phone}
        onChange={(event) => { setDraft({ ...draft, phone: event.target.value }); setMessage(""); }} />
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn" type="submit" disabled={busy || !dirty}>{busy ? "Enregistrement…" : "Rectifier les coordonnées"}</button>
      </div>
    </form> : <dl>
      <dt>Email</dt><dd>{saved.email || "Non fourni"}</dd>
      <dt>Téléphone</dt><dd>{saved.phone || "Non fourni"}</dd>
    </dl>}
    <dl style={{ marginTop: 12 }}>
      <dt>Consentement marketing</dt><dd>{saved.marketingConsent ? "Actif" : "Non consenti"}</dd>
    </dl>
    {canEdit && saved.marketingConsent && <button className="btn" type="button" disabled={busy} onClick={withdrawMarketing}>
      Retirer le consentement marketing
    </button>}
    {message && <p role="status" className="notice">{message}</p>}
  </div>;
}

"use client";

import { useState } from "react";

export function CustomerNote({ customerId, initialNote, canEdit }: { customerId: string; initialNote: string; canEdit: boolean }) {
  const [note, setNote] = useState(initialNote);
  const [savedNote, setSavedNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customers/${customerId}/note`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!response.ok) {
        setMessage(response.status === 400 ? "Note invalide : 500 caractères maximum, sans HTML." : "Impossible d’enregistrer la note.");
        return;
      }
      setSavedNote(note.trim());
      setNote(note.trim());
      setMessage("Note enregistrée.");
    } catch {
      setMessage("Connexion perdue. Réessaie après vérification du réseau.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="card" style={{ marginTop: 18 }}>
    <h3>Note interne</h3>
    {canEdit ? <>
      <label htmlFor="customer-internal-note">Visible par l’équipe, jamais par le client.</label>
      <textarea id="customer-internal-note" className="input" rows={4} maxLength={500}
        value={note} onChange={(event) => { setNote(event.target.value); setMessage(""); }} />
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn" type="button" disabled={busy || note === savedNote} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer la note"}
        </button>
        <span className="muted">{note.length}/500</span>
      </div>
      {message && <p role="status" className="notice">{message}</p>}
    </> : <p>{savedNote || "Aucune note interne."}</p>}
  </section>;
}

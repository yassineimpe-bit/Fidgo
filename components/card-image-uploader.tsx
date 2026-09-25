"use client";

import { useState } from "react";

const ERRORS: Record<string, string> = {
  FILE_TOO_LARGE: "Fichier trop lourd : 4 Mo au maximum.",
  UNSUPPORTED_FORMAT: "Format refusé : JPEG, PNG ou WebP uniquement.",
  IMAGE_TOO_SMALL: "Image trop petite : au moins 600 × 300 pixels.",
  IMAGE_TOO_LARGE: "Image trop grande : 8 000 pixels de côté au maximum.",
  INVALID_IMAGE: "Image illisible.",
  CARD_IMAGE_UNAVAILABLE: "Le visuel n’est pas encore disponible sur ce serveur.",
};

/** Visuel de la carte : bannière recadrée au centre en 2:1 par le serveur. */
export function CardImageUploader({ cardImageUrl, onChange }: { cardImageUrl: string | null; onChange: (url: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/restaurant/card-image", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(ERRORS[String(result.error)] || "Import impossible pour le moment."); return; }
      onChange(String(result.cardImageUrl));
      setMessage("Visuel importé.");
    } catch {
      setMessage("Connexion perdue. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Retirer le visuel de la carte ?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/restaurant/card-image", { method: "DELETE" });
      if (!response.ok) { setMessage("Impossible de retirer le visuel."); return; }
      onChange(null);
      setMessage("Visuel retiré.");
    } catch {
      setMessage("Connexion perdue. Réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="field">
    <label htmlFor="card-image-file">Importer un visuel</label>
    <input id="card-image-file" className="input" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }}/>
    <small className="muted">Photo de la vitrine, d’un produit… Recadrée au centre au format bannière (2:1), 4 Mo au maximum.</small>
    {cardImageUrl && <>
      {/* eslint-disable-next-line @next/next/no-img-element -- visuel déjà ré-encodé et servi par Retiko. */}
      <img src={cardImageUrl} alt="Visuel actuel de la carte" style={{width:"100%",maxWidth:320,aspectRatio:"2 / 1",objectFit:"cover",borderRadius:12,marginTop:8}}/>
      <button type="button" className="btn" onClick={remove} disabled={busy}>Retirer le visuel</button>
    </>}
    {message && <p className="muted" role="status">{message}</p>}
  </div>;
}

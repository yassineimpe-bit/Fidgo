"use client";

import { ChangeEvent, KeyboardEvent, PointerEvent, useRef, useState } from "react";
import { LOGO_MAX_BYTES, LOGO_MIN_SIDE, uploadedLogoId } from "@/lib/logo";

const VIEW = 240;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const ERRORS: Record<string, string> = {
  FILE_TOO_LARGE: "Fichier trop lourd : 2 Mo maximum.",
  UNSUPPORTED_FORMAT: "Format non pris en charge : JPEG, PNG ou WebP uniquement.",
  IMAGE_TOO_SMALL: `Image trop petite : ${LOGO_MIN_SIDE} × ${LOGO_MIN_SIDE} px minimum.`,
  IMAGE_TOO_LARGE: "Image trop grande : 6000 px maximum par côté.",
  INVALID_CROP: "Cadrage invalide. Réessaie.",
  INVALID_IMAGE: "Image illisible. Essaie un autre fichier.",
  LOGO_STORAGE_UNAVAILABLE: "L’import de logo n’est pas encore disponible. Utilise une URL HTTPS pour l’instant.",
  RATE_LIMITED: "Trop d’imports. Réessaie dans quelques minutes.",
  FORBIDDEN: "Seuls le propriétaire et les managers peuvent changer le logo.",
};

type Source = { url: string; width: number; height: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Cadrage carré en pixels de l'image orientée, recalculé à partir du centre et du zoom. */
function cropFor(source: Source, zoom: number, center: { x: number; y: number }) {
  const size = Math.max(LOGO_MIN_SIDE, Math.floor(Math.min(source.width, source.height) / zoom));
  const x = Math.round(clamp(center.x - size / 2, 0, source.width - size));
  const y = Math.round(clamp(center.y - size / 2, 0, source.height - size));
  return { x, y, size };
}

export function LogoUploader({ logoUrl, onChange }: { logoUrl: string; onChange: (url: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const drag = useRef<{ x: number; y: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setSource(null);
    setZoom(1);
    if (input.current) input.current.value = "";
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    setMessage("");
    if (!chosen) return;
    if (!ACCEPTED.includes(chosen.type)) { setMessage(ERRORS.UNSUPPORTED_FORMAT); event.target.value = ""; return; }
    if (chosen.size > LOGO_MAX_BYTES) { setMessage(ERRORS.FILE_TOO_LARGE); event.target.value = ""; return; }
    // data: plutôt que blob: : la CSP n'autorise que 'self', data: et https:.
    const reader = new FileReader();
    reader.onerror = () => setMessage(ERRORS.INVALID_IMAGE);
    reader.onload = () => {
      const url = String(reader.result);
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth < LOGO_MIN_SIDE || image.naturalHeight < LOGO_MIN_SIDE) { setMessage(ERRORS.IMAGE_TOO_SMALL); return; }
        setFile(chosen);
        setSource({ url, width: image.naturalWidth, height: image.naturalHeight });
        setCenter({ x: image.naturalWidth / 2, y: image.naturalHeight / 2 });
        setZoom(1);
      };
      image.onerror = () => setMessage(ERRORS.INVALID_IMAGE);
      image.src = url;
    };
    reader.readAsDataURL(chosen);
  }

  const crop = source ? cropFor(source, zoom, center) : null;
  const scale = crop ? VIEW / crop.size : 1;

  function pan(dx: number, dy: number) {
    if (!source || !crop) return;
    const half = crop.size / 2;
    setCenter((current) => ({
      x: clamp(current.x - dx / scale, half, source.width - half),
      y: clamp(current.y - dy / scale, half, source.height - half),
    }));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    pan(event.clientX - drag.current.x, event.clientY - drag.current.y);
    drag.current = { x: event.clientX, y: event.clientY };
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = 12;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pan(move[0], move[1]);
  }

  async function upload() {
    if (!file || !crop) return;
    setBusy(true);
    setMessage("");
    const body = new FormData();
    body.set("file", file);
    body.set("cropX", String(crop.x));
    body.set("cropY", String(crop.y));
    body.set("cropSize", String(crop.size));
    try {
      const response = await fetch("/api/restaurant/logo", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(ERRORS[String(data.error)] || "Impossible d’importer le logo."); return; }
      onChange(String(data.logoUrl));
      reset();
      setMessage("Logo importé.");
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Retirer le logo importé ?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/restaurant/logo", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(ERRORS[String(data.error)] || "Impossible de retirer le logo."); return; }
      onChange("");
      setMessage("Logo retiré.");
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="field logo-uploader">
    <label htmlFor="restaurant-logo-file">Importer un logo</label>
    <input ref={input} id="restaurant-logo-file" className="input" type="file" accept={ACCEPTED.join(",")} onChange={choose} disabled={busy}/>
    <small className="muted">JPEG, PNG ou WebP, 2 Mo maximum. L’image est recadrée en carré et convertie par Retiko.</small>
    {source && crop && <div className="logo-cropper">
      <div
        className="logo-crop-view"
        role="img"
        aria-label="Cadrage du logo : glisse pour déplacer, flèches du clavier pour ajuster"
        tabIndex={0}
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onKeyDown={onKeyDown}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (data:) du fichier choisi, jamais optimisé côté serveur. */}
        <img src={source.url} alt="" draggable={false} style={{ width: source.width * scale, height: source.height * scale, transform: `translate(${-crop.x * scale}px, ${-crop.y * scale}px)` }}/>
      </div>
      <label htmlFor="restaurant-logo-zoom">Zoom</label>
      <input id="restaurant-logo-zoom" type="range" min={1} max={Math.max(1, Math.min(source.width, source.height) / LOGO_MIN_SIDE)} step={0.05} value={zoom}
        onChange={(event) => setZoom(Number(event.target.value))}/>
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={upload} disabled={busy}>{busy ? "Import…" : "Enregistrer le logo"}</button>
        <button className="btn" type="button" onClick={reset} disabled={busy}>Annuler</button>
      </div>
    </div>}
    {!source && uploadedLogoId(logoUrl) && <div className="actions">
      <button className="btn" type="button" onClick={remove} disabled={busy}>Retirer le logo</button>
    </div>}
    {message && <p role="status" className="notice">{message}</p>}
  </div>;
}

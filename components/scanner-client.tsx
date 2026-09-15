"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

type CardView = {
  token: string;
  shortCode: string;
  balance: number;
  firstName?: string;
  mode: "STAMPS" | "POINTS";
  pointsRule: "PER_PURCHASE" | "PER_EURO";
  threshold: number;
  rewardLabel: string;
  defaultEarn: number;
  pointsPerEuro: number;
  rewardAvailable: boolean;
};

type Metric = {
  phase: "lookup" | "action";
  action?: "credit" | "redeem";
  networkMs: number;
  serverMs: number;
  totalMs: number;
  ok: boolean;
  at: string;
};

function saveMetric(metric: Metric) {
  try {
    const previous = JSON.parse(localStorage.getItem("loyalty_scan_metrics") || "[]") as Metric[];
    localStorage.setItem("loyalty_scan_metrics", JSON.stringify([...previous, metric].slice(-50)));
  } catch {}
}

function beep() {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
  } catch {}
}

export function ScannerClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const busyRef = useRef(false);
  const lastTokenRef = useRef<{ value: string; at: number } | null>(null);
  const detectedAtRef = useRef(performance.now());
  const actionKeyRef = useRef<{ kind: "credit" | "redeem"; key: string } | null>(null);

  const [status, setStatus] = useState("Initialisation caméra…");
  const [card, setCard] = useState<CardView | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [purchase, setPurchase] = useState("");
  const [permissionError, setPermissionError] = useState(false);
  const [manualQuery, setManualQuery] = useState("");

  async function loadCardFromToken(value: string, detectedAt = performance.now()) {
    const networkStarted = performance.now();
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: value }),
    });
    const networkMs = Math.round(performance.now() - networkStarted);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "SCAN_ERROR");
    setCard(data);
    setStatus("Carte prête");
    detectedAtRef.current = detectedAt;
    const serverMs = Number(data.serverMs || 0);
    saveMetric({ phase: "lookup", networkMs: Math.max(0, networkMs - serverMs), serverMs, totalMs: Math.round(performance.now() - detectedAt), ok: true, at: new Date().toISOString() });
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(video, async (result) => {
      const value = result.data.trim();
      if (!value.startsWith("LOY1:")) return;
      const now = performance.now();
      if (busyRef.current) return;
      if (lastTokenRef.current?.value === value && now - lastTokenRef.current.at < 2000) return;
      busyRef.current = true;
      lastTokenRef.current = { value, at: now };
      setStatus("Carte détectée…");
      setError("");
      try { await loadCardFromToken(value, now); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Erreur"); setStatus("Scan refusé"); window.setTimeout(reset, 1300); }
    }, { preferredCamera: "environment", highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 12, returnDetailedScanResult: true });
    scanner.start().then(() => setStatus("Caméra active")).catch(() => { setPermissionError(true); setStatus("Caméra inaccessible"); });
    return () => { scanner.stop(); scanner.destroy(); };
  }, []);

  async function manualLookup(event: FormEvent) {
    event.preventDefault();
    if (!manualQuery.trim()) return;
    setError(""); busyRef.current = true;
    const detectedAt = performance.now();
    try {
      const response = await fetch(`/api/lookup?q=${encodeURIComponent(manualQuery.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "NOT_FOUND");
      await loadCardFromToken(`LOY1:${data.token}`, detectedAt);
    } catch (caught) { busyRef.current = false; setError(caught instanceof Error ? caught.message : "Erreur"); }
  }

  async function perform(kind: "credit" | "redeem") {
    if (!card) return;
    setAction(kind); setError("");
    if (!actionKeyRef.current || actionKeyRef.current.kind !== kind) actionKeyRef.current = { kind, key: crypto.randomUUID() };
    const idempotencyKey = actionKeyRef.current.key;
    const started = performance.now();
    try {
      const payload: { token: string; idempotencyKey: string; purchaseAmountCents?: number } = { token: card.token, idempotencyKey };
      if (kind === "credit" && card.mode === "POINTS" && card.pointsRule === "PER_EURO") {
        const parsed = Number(purchase.replace(",", "."));
        if (!Number.isFinite(parsed) || parsed <= 0) { setError("Saisis un montant d’achat valide."); setAction(""); return; }
        payload.purchaseAmountCents = Math.round(parsed * 100);
      }
      const response = await fetch(kind === "credit" ? "/api/credit" : "/api/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      const actionMs = Math.round(performance.now() - started);
      if (!response.ok) throw new Error(data.error || "ACTION_ERROR");
      actionKeyRef.current = null;
      const newBalance = Number(data.balance);
      setCard({ ...card, balance: newBalance, rewardAvailable: newBalance >= card.threshold });
      beep(); if (navigator.vibrate) navigator.vibrate(60);
      setStatus(kind === "credit" ? `+${data.delta || card.defaultEarn} validé` : `${card.rewardLabel} utilisée`);
      const serverMs = Number(data.serverMs || 0);
      saveMetric({ phase: "action", action: kind, networkMs: Math.max(0, actionMs - serverMs), serverMs, totalMs: Math.round(performance.now() - detectedAtRef.current), ok: true, at: new Date().toISOString() });
      window.setTimeout(reset, 1250);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Erreur"); setStatus("Action refusée — retry sûr"); }
    finally { setAction(""); }
  }

  function reset() { setCard(null); setPurchase(""); setError(""); setManualQuery(""); actionKeyRef.current = null; busyRef.current = false; setStatus("Caméra active"); }

  return <main className="scanner-page"><video ref={videoRef} className="scanner-video" playsInline muted autoPlay /><div className="scanner-shade" /><div className="scanner-top"><span className="scanner-pill">{status}</span><a className="scanner-pill" href="/s/stats">Stats</a></div><section className="scan-sheet">{card ? <div className="scan-result"><div style={{ color: "#aaa" }}>{card.mode === "STAMPS" ? "Tampons" : "Points"} · {card.shortCode}</div><strong>{card.firstName || "Client"}</strong><div style={{ fontSize: 20 }}>{card.balance} / {card.threshold} {card.mode === "STAMPS" ? "tampons" : "points"}</div>{card.rewardAvailable && <div className="scan-success">Récompense disponible : {card.rewardLabel}</div>}{card.mode === "POINTS" && card.pointsRule === "PER_EURO" && <div className="field"><label>Montant achat (€)</label><input className="input" inputMode="decimal" value={purchase} onChange={(e) => setPurchase(e.target.value)} placeholder="12,50" /></div>}{error && <div className="scan-error">{error}</div>}<div className="scan-actions"><button className="scan-main" disabled={Boolean(action)} onClick={() => perform("credit")}>{card.mode === "STAMPS" ? `+${card.defaultEarn} tampon${card.defaultEarn > 1 ? "s" : ""}` : card.pointsRule === "PER_EURO" ? "Ajouter les points" : `+${card.defaultEarn} points`}</button><button className="scan-redeem" disabled={!card.rewardAvailable || Boolean(action)} onClick={() => perform("redeem")}>Utiliser récompense</button></div><button className="btn" style={{ marginTop: 10, width: "100%", background: "transparent", color: "white", borderColor: "#444" }} onClick={reset}>Annuler</button></div> : <div><strong style={{ fontSize: 20 }}>{permissionError ? "Caméra indisponible" : "Présente le QR client"}</strong><p style={{ margin: "6px 0 12px", color: "#aaa" }}>{permissionError ? "Utilise le code court ou l’email ci-dessous." : "La caméra reste ouverte. Aucun bouton Scanner."}</p><form onSubmit={manualLookup} style={{ display: "flex", gap: 8 }}><input className="input" value={manualQuery} onChange={(e) => setManualQuery(e.target.value)} placeholder="Code court ou email" /><button className="btn" type="submit">Chercher</button></form>{error && <div className="scan-error" style={{ marginTop: 10 }}>{error}</div>}</div>}</section></main>;
}

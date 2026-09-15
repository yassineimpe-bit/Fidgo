"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { scannerErrorInfo, type ScannerErrorInfo } from "@/lib/scanner-messages";

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
  canOverrideCooldown: boolean;
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

function feedback(kind: "success" | "reward" | "error") {
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor) {
      const context = new AudioContextCtor();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = kind === "error" ? 220 : kind === "reward" ? 1_120 : 880;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + (kind === "reward" ? 0.18 : 0.08));
    }
  } catch {}
  if (navigator.vibrate) {
    navigator.vibrate(kind === "error" ? [90, 60, 90] : kind === "reward" ? [60, 50, 140] : 60);
  }
}

export function ScannerClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const busyRef = useRef(false);
  const lastTokenRef = useRef<{ value: string; at: number } | null>(null);
  const detectedAtRef = useRef(performance.now());
  const actionKeyRef = useRef<{ kind: "credit" | "redeem"; key: string } | null>(null);

  const [status, setStatus] = useState("Initialisation caméra…");
  const [card, setCard] = useState<CardView | null>(null);
  const [error, setError] = useState<ScannerErrorInfo | null>(null);
  const [action, setAction] = useState("");
  const [purchase, setPurchase] = useState("");
  const [permissionError, setPermissionError] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [online, setOnline] = useState(true);
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  async function loadCardFromToken(value: string, detectedAt = performance.now()) {
    if (!navigator.onLine) throw new Error("OFFLINE");

    const networkStarted = performance.now();
    let serverMs = 0;
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const networkMs = Math.round(performance.now() - networkStarted);
      const data = await response.json();
      serverMs = Number(data.serverMs || 0);
      if (!response.ok) throw new Error(data.error || "SCAN_ERROR");
      setCard(data);
      setCooldownRemaining(null);
      setOverrideReason("");
      setStatus("Carte prête");
      detectedAtRef.current = detectedAt;
      saveMetric({ phase: "lookup", networkMs: Math.max(0, networkMs - serverMs), serverMs, totalMs: Math.round(performance.now() - detectedAt), ok: true, at: new Date().toISOString() });
    } catch (caught) {
      const elapsed = Math.round(performance.now() - networkStarted);
      saveMetric({ phase: "lookup", networkMs: Math.max(0, elapsed - serverMs), serverMs, totalMs: Math.round(performance.now() - detectedAt), ok: false, at: new Date().toISOString() });
      throw caught;
    }
  }

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!online) {
      setStatus("Hors ligne");
      setError(scannerErrorInfo(new Error("OFFLINE")));
      return;
    }
    setError((current) => current?.code === "OFFLINE" ? null : current);
    if (!card && !busyRef.current) setStatus(permissionError ? "Caméra inaccessible" : "Caméra active");
  }, [online, card, permissionError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(video, async (result) => {
      const value = result.data.trim();
      if (!value.startsWith("LOY1:")) return;
      const now = performance.now();
      if (busyRef.current) return;
      if (lastTokenRef.current?.value === value && now - lastTokenRef.current.at < 2_000) return;
      busyRef.current = true;
      lastTokenRef.current = { value, at: now };
      setStatus("Carte détectée…");
      setError(null);
      try {
        await loadCardFromToken(value, now);
      } catch (caught) {
        const info = scannerErrorInfo(caught);
        setError(info);
        feedback("error");
        setStatus(info.sessionExpired ? "Session expirée" : info.network ? "Connexion indisponible" : "Scan refusé");
        if (info.sessionExpired || info.network) busyRef.current = false;
        else window.setTimeout(() => {
          setCard(null);
          setPurchase("");
          setManualQuery("");
          setCooldownRemaining(null);
          setOverrideReason("");
          actionKeyRef.current = null;
          busyRef.current = false;
          setError(null);
          setStatus("Caméra active");
        }, 1_300);
      }
    }, {
      preferredCamera: "environment",
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 12,
      returnDetailedScanResult: true,
    });
    scanner.start()
      .then(() => setStatus(navigator.onLine ? "Caméra active" : "Hors ligne"))
      .catch(() => {
        setPermissionError(true);
        setStatus("Caméra inaccessible");
      });
    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, []);

  async function manualLookup(event: FormEvent) {
    event.preventDefault();
    if (!manualQuery.trim()) return;
    setError(null);
    busyRef.current = true;
    const detectedAt = performance.now();
    try {
      if (!navigator.onLine) throw new Error("OFFLINE");
      const response = await fetch(`/api/lookup?q=${encodeURIComponent(manualQuery.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "NOT_FOUND");
      await loadCardFromToken(`LOY1:${data.token}`, detectedAt);
    } catch (caught) {
      busyRef.current = false;
      const info = scannerErrorInfo(caught);
      setError(info);
      feedback("error");
      setStatus(info.sessionExpired ? "Session expirée" : info.network ? "Connexion indisponible" : "Recherche refusée");
    }
  }

  async function perform(kind: "credit" | "redeem", reason?: string) {
    if (!card) return;
    if (!navigator.onLine) {
      setOnline(false);
      setStatus("Hors ligne — aucune action envoyée");
      setError(scannerErrorInfo(new Error("OFFLINE")));
      return;
    }

    setAction(kind);
    setError(null);
    if (!actionKeyRef.current || actionKeyRef.current.kind !== kind) {
      actionKeyRef.current = { kind, key: crypto.randomUUID() };
    }
    const idempotencyKey = actionKeyRef.current.key;
    const started = performance.now();
    let serverMs = 0;

    try {
      const payload: { token: string; idempotencyKey: string; purchaseAmountCents?: number; overrideReason?: string } = {
        token: card.token,
        idempotencyKey,
      };
      if (reason) payload.overrideReason = reason;
      if (kind === "credit" && card.mode === "POINTS" && card.pointsRule === "PER_EURO") {
        const parsed = Number(purchase.replace(",", "."));
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("INVALID_AMOUNT");
        payload.purchaseAmountCents = Math.round(parsed * 100);
      }

      const response = await fetch(kind === "credit" ? "/api/credit" : "/api/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      const actionMs = Math.round(performance.now() - started);
      serverMs = Number(data.serverMs || 0);
      if (!response.ok) {
        if (data.error === "COOLDOWN") setCooldownRemaining(Number(data.remainingSeconds) || null);
        throw new Error(data.error || "ACTION_ERROR");
      }

      actionKeyRef.current = null;
      const newBalance = Number(data.balance);
      const rewardReached = kind === "credit" && !card.rewardAvailable && newBalance >= card.threshold;
      setCard({ ...card, balance: newBalance, rewardAvailable: newBalance >= card.threshold });
      setCooldownRemaining(null);
      setOverrideReason("");
      feedback(kind === "redeem" || rewardReached ? "reward" : "success");
      setStatus(kind === "credit" ? `+${data.delta || card.defaultEarn} validé` : `${card.rewardLabel} utilisée`);
      saveMetric({ phase: "action", action: kind, networkMs: Math.max(0, actionMs - serverMs), serverMs, totalMs: Math.round(performance.now() - detectedAtRef.current), ok: true, at: new Date().toISOString() });
      window.setTimeout(reset, 1_250);
    } catch (caught) {
      const info = scannerErrorInfo(caught);
      const actionMs = Math.round(performance.now() - started);
      setError(info);
      feedback("error");
      setStatus(info.sessionExpired ? "Session expirée" : info.network ? "Connexion perdue — retry sûr" : "Action refusée");
      saveMetric({ phase: "action", action: kind, networkMs: Math.max(0, actionMs - serverMs), serverMs, totalMs: Math.round(performance.now() - detectedAtRef.current), ok: false, at: new Date().toISOString() });
      if (!info.retryable) actionKeyRef.current = null;
    } finally {
      setAction("");
    }
  }

  function reset() {
    setCard(null);
    setPurchase("");
    setManualQuery("");
    setCooldownRemaining(null);
    setOverrideReason("");
    actionKeyRef.current = null;
    busyRef.current = false;
    if (navigator.onLine) {
      setError(null);
      setStatus(permissionError ? "Caméra inaccessible" : "Caméra active");
    } else {
      setError(scannerErrorInfo(new Error("OFFLINE")));
      setStatus("Hors ligne");
    }
  }

  const retryingCredit = Boolean(error?.retryable && actionKeyRef.current?.kind === "credit");
  const retryingRedeem = Boolean(error?.retryable && actionKeyRef.current?.kind === "redeem");
  const normalCreditLabel = card?.mode === "STAMPS"
    ? `+${card.defaultEarn} tampon${card.defaultEarn > 1 ? "s" : ""}`
    : card?.pointsRule === "PER_EURO"
      ? "Ajouter les points"
      : `+${card?.defaultEarn || 0} points`;

  return <main className="scanner-page">
    <video ref={videoRef} className="scanner-video" playsInline muted autoPlay />
    <div className="scanner-shade" />
    <div className="scanner-top">
      <span className="scanner-pill">{online ? status : "Hors ligne"}</span>
      <a className="scanner-pill" href="/s/stats">Stats</a>
    </div>
    <section className="scan-sheet">
      {card ? <div className="scan-result">
        <div style={{color:"#aaa"}}>{card.mode === "STAMPS" ? "Tampons" : "Points"} · {card.shortCode}</div>
        <strong>{card.firstName || "Client"}</strong>
        <div style={{fontSize:20}}>{card.balance} / {card.threshold} {card.mode === "STAMPS" ? "tampons" : "points"}</div>
        {card.rewardAvailable && <div className="scan-success">Récompense disponible : {card.rewardLabel}</div>}
        {card.mode === "POINTS" && card.pointsRule === "PER_EURO" && <div className="field">
          <label>Montant achat (€)</label>
          <input className="input" inputMode="decimal" value={purchase} onChange={(event) => setPurchase(event.target.value)} placeholder="12,50" />
        </div>}
        {error && <div className="scan-error">
          {error.code === "COOLDOWN" && cooldownRemaining
            ? `Passage déjà enregistré il y a moins de deux minutes. Réessaie dans ${cooldownRemaining} s.`
            : error.message}
          {error.sessionExpired && <div style={{marginTop:8}}><a className="btn" href="/login">Se reconnecter</a></div>}
        </div>}
        {error?.code === "COOLDOWN" && card.canOverrideCooldown && <div className="field">
          <label>Motif obligatoire pour créditer quand même</label>
          <input className="input" value={overrideReason} maxLength={240} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Ex. second achat distinct" />
          <button className="btn btn-danger" disabled={!overrideReason.trim() || Boolean(action)} onClick={() => perform("credit", overrideReason.trim())}>Créditer quand même</button>
        </div>}
        <div className="scan-actions">
          <button className="scan-main" disabled={!online || Boolean(action)} onClick={() => perform("credit")}>{retryingCredit ? "Réessayer sans doublon" : normalCreditLabel}</button>
          <button className="scan-redeem" disabled={!online || !card.rewardAvailable || Boolean(action)} onClick={() => perform("redeem")}>{retryingRedeem ? "Réessayer sans doublon" : "Utiliser récompense"}</button>
        </div>
        <button className="btn" style={{marginTop:10,width:"100%",background:"transparent",color:"white",borderColor:"#444"}} onClick={reset}>Annuler</button>
      </div> : <div>
        <strong style={{fontSize:20}}>{permissionError ? "Caméra indisponible" : online ? "Présente le QR client" : "Connexion internet requise"}</strong>
        <p style={{margin:"6px 0 12px",color:"#aaa"}}>{permissionError ? "Utilise le code court ou l’email ci-dessous." : online ? "La caméra reste ouverte. Aucun bouton Scanner." : "Aucune action fidélité ne sera envoyée tant que le réseau n’est pas revenu."}</p>
        <form onSubmit={manualLookup} style={{display:"flex",gap:8}}>
          <input className="input" value={manualQuery} onChange={(event) => setManualQuery(event.target.value)} placeholder="Code court ou email" disabled={!online} />
          <button className="btn" type="submit" disabled={!online}>Chercher</button>
        </form>
        {error && <div className="scan-error" style={{marginTop:10}}>
          {error.message}
          {error.sessionExpired && <div style={{marginTop:8}}><a className="btn" href="/login">Se reconnecter</a></div>}
        </div>}
      </div>}
    </section>
  </main>;
}

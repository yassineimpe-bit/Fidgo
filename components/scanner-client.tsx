"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import {
  CAMERA_ISSUE_INFO,
  REAR_CAMERA_CONSTRAINTS,
  classifyCameraError,
  extractLoyaltyQr,
  isDuplicateQr,
  stopMediaStream,
  type CameraIssue,
} from "@/lib/scanner-camera";
import { scannerErrorInfo, type ScannerErrorInfo } from "@/lib/scanner-messages";
import { PwaInstallHint } from "@/components/pwa-install-hint";

type CardView = {
  token: string;
  shortCode: string;
  balance: number;
  lastEarnAt?: string | null;
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

type ScannerEvent =
  | "CAMERA_START"
  | "CAMERA_READY"
  | "CAMERA_FAILED"
  | "QR_DETECTED"
  | "SCAN_SENT"
  | "SCAN_SUCCESS"
  | "SCAN_FAILED";

function recordPilotEvent(eventType: ScannerEvent, durationMs: number, source: "qr" | "manual", errorCode?: string) {
  const boundedDurationMs = Math.min(60_000, Math.max(0, Math.round(durationMs)));
  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventType, durationMs: boundedDurationMs, source, errorCode }),
    keepalive: true,
  }).catch(() => undefined);
}

function formatLastPassage(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 10_000) return "à l’instant";
  if (diffMs < 60_000) return `il y a ${Math.round(diffMs / 1_000)} s`;
  if (diffMs < 3_600_000) return `il y a ${Math.round(diffMs / 60_000)} min`;
  if (diffMs < 86_400_000) return `il y a ${Math.round(diffMs / 3_600_000)} h`;
  return `il y a ${Math.round(diffMs / 86_400_000)} j`;
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
      oscillator.onended = () => { void context.close(); };
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
  const lastInvalidQrAtRef = useRef(0);
  const detectedAtRef = useRef(performance.now());
  const actionKeyRef = useRef<{ kind: "credit" | "redeem"; key: string } | null>(null);

  const [status, setStatus] = useState("Initialisation caméra…");
  const [card, setCard] = useState<CardView | null>(null);
  const [error, setError] = useState<ScannerErrorInfo | null>(null);
  const [action, setAction] = useState("");
  const [purchase, setPurchase] = useState("");
  const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [online, setOnline] = useState(true);
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [restartTick, setRestartTick] = useState(0);
  const [rewardJustReached, setRewardJustReached] = useState(false);
  const permissionError = cameraIssue !== null;

  async function loadCardFromToken(value: string, detectedAt = performance.now(), source: "qr" | "manual" = "qr") {
    if (!navigator.onLine) throw new Error("OFFLINE");

    const networkStarted = performance.now();
    let serverMs = 0;
    try {
      const scanRequest = fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      // Le flux métier est lancé avant la télémétrie afin que celle-ci
      // n'ajoute aucune latence perceptible au scan en caisse.
      recordPilotEvent("SCAN_SENT", Math.round(networkStarted - detectedAt), source);
      const response = await scanRequest;
      const networkMs = Math.round(performance.now() - networkStarted);
      const data = await response.json();
      serverMs = Number(data.serverMs || 0);
      if (!response.ok) throw new Error(data.error || "SCAN_ERROR");
      setCard(data);
      setCooldownRemaining(null);
      setOverrideReason("");
      setStatus("Carte prête");
      detectedAtRef.current = detectedAt;
      const totalMs = Math.round(performance.now() - detectedAt);
      saveMetric({ phase: "lookup", networkMs: Math.max(0, networkMs - serverMs), serverMs, totalMs, ok: true, at: new Date().toISOString() });
      recordPilotEvent("SCAN_SUCCESS", totalMs, source);
    } catch (caught) {
      const elapsed = Math.round(performance.now() - networkStarted);
      const totalMs = Math.round(performance.now() - detectedAt);
      saveMetric({ phase: "lookup", networkMs: Math.max(0, elapsed - serverMs), serverMs, totalMs, ok: false, at: new Date().toISOString() });
      recordPilotEvent("SCAN_FAILED", totalMs, source, scannerErrorInfo(caught).code);
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

    let scanner: QrScanner | null = null;
    let stream: MediaStream | null = null;
    let disposed = false;
    let generation = 0;
    let starting = false;
    let restartRequested = false;
    let feedbackTimer: number | undefined;

    // WebKit iOS exige playsinline avant l'attachement du MediaStream. Les
    // attributs sont aussi posés directement pour le mode PWA standalone.
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.setAttribute("autoplay", "");

    const clearFeedbackTimer = () => {
      if (feedbackTimer !== undefined) window.clearTimeout(feedbackTimer);
      feedbackTimer = undefined;
    };

    const stopCamera = () => {
      generation += 1;
      const currentScanner = scanner;
      const currentStream = stream;
      scanner = null;
      stream = null;
      currentScanner?.destroy();
      // qr-scanner ne retire pas son overlay au destroy(). Sans ceci, chaque
      // retour d'arrière-plan PWA empilerait un nouveau viseur dans le DOM.
      currentScanner?.$overlay?.remove();
      video.pause();
      if (video.srcObject) video.srcObject = null;
      stopMediaStream(currentStream);
    };

    const reportCameraFailure = (issue: CameraIssue, startedAt: number) => {
      if (disposed) return;
      stopCamera();
      setCameraIssue(issue);
      setStatus("Caméra inaccessible");
      recordPilotEvent(
        "CAMERA_FAILED",
        Math.round(performance.now() - startedAt),
        "qr",
        CAMERA_ISSUE_INFO[issue].telemetryCode,
      );
    };

    const onDecode = async (result: QrScanner.ScanResult) => {
      const now = performance.now();
      const value = extractLoyaltyQr(result.data);

      if (!value) {
        if (now - lastInvalidQrAtRef.current < 2_500) return;
        lastInvalidQrAtRef.current = now;
        const invalid = scannerErrorInfo(new Error("INVALID_QR"));
        setError(invalid);
        setStatus("QR non reconnu");
        feedback("error");
        recordPilotEvent("SCAN_FAILED", 0, "qr", "INVALID_QR");
        clearFeedbackTimer();
        feedbackTimer = window.setTimeout(() => {
          if (!busyRef.current) {
            setError(null);
            setStatus("Caméra active");
          }
        }, 1_500);
        return;
      }

      if (busyRef.current || isDuplicateQr(lastTokenRef.current, value, now)) return;
      busyRef.current = true;
      lastTokenRef.current = { value, at: now };
      setStatus("Carte détectée…");
      setError(null);
      try {
        const lookup = loadCardFromToken(value, now);
        recordPilotEvent("QR_DETECTED", 0, "qr");
        await lookup;
      } catch (caught) {
        const info = scannerErrorInfo(caught);
        setError(info);
        feedback("error");
        setStatus(info.sessionExpired ? "Session expirée" : info.network ? "Connexion indisponible" : "Scan refusé");
        if (info.sessionExpired || info.network) busyRef.current = false;
        else {
          clearFeedbackTimer();
          feedbackTimer = window.setTimeout(() => {
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
      }
    };

    const startCamera = async () => {
      if (disposed || document.hidden) return;
      if (starting) {
        restartRequested = true;
        return;
      }
      if (scanner && stream?.getVideoTracks().some((track) => track.readyState === "live")) return;

      starting = true;
      restartRequested = false;
      const attempt = ++generation;
      const startedAt = performance.now();
      const mediaDevicesAvailable = Boolean(navigator.mediaDevices?.getUserMedia);

      setCameraIssue(null);
      setStatus("Initialisation caméra…");
      recordPilotEvent("CAMERA_START", 0, "qr");

      try {
        if (!window.isSecureContext || !mediaDevicesAvailable) {
          reportCameraFailure(classifyCameraError(null, {
            secureContext: window.isSecureContext,
            mediaDevicesAvailable,
          }), startedAt);
          return;
        }

        const nextStream = await navigator.mediaDevices.getUserMedia(REAR_CAMERA_CONSTRAINTS);
        if (disposed || document.hidden || attempt !== generation) {
          stopMediaStream(nextStream);
          return;
        }

        stream = nextStream;
        video.srcObject = nextStream;
        const nextScanner = new QrScanner(video, onDecode, {
          preferredCamera: "environment",
          calculateScanRegion: (source) => {
            const size = Math.round(Math.min(source.videoWidth, source.videoHeight) * 0.82);
            return {
              x: Math.round((source.videoWidth - size) / 2),
              y: Math.round((source.videoHeight - size) / 2),
              width: size,
              height: size,
              downScaledWidth: 480,
              downScaledHeight: 480,
            };
          },
          onDecodeError: (decodeError) => {
            if (decodeError === QrScanner.NO_QR_CODE_FOUND || disposed) return;
            reportCameraFailure("decoder-failed", startedAt);
          },
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 15,
          returnDetailedScanResult: true,
        });
        scanner = nextScanner;
        await nextScanner.start();

        if (disposed || document.hidden || attempt !== generation) {
          stopCamera();
          return;
        }

        for (const track of nextStream.getVideoTracks()) {
          track.addEventListener("ended", () => {
            if (!disposed && !document.hidden && attempt === generation) {
              reportCameraFailure("start-failed", startedAt);
            }
          }, { once: true });
        }
        setCameraIssue(null);
        setStatus(navigator.onLine ? "Caméra prête" : "Hors ligne");
        recordPilotEvent("CAMERA_READY", Math.round(performance.now() - startedAt), "qr");
      } catch (caught) {
        if (disposed || document.hidden || attempt !== generation) return;
        reportCameraFailure(classifyCameraError(caught, {
          secureContext: window.isSecureContext,
          mediaDevicesAvailable,
        }), startedAt);
      } finally {
        starting = false;
        if (restartRequested && !disposed && !document.hidden) {
          restartRequested = false;
          void startCamera();
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) stopCamera();
      else void startCamera();
    };
    const onPageHide = () => stopCamera();
    const onPageShow = () => void startCamera();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    void startCamera();

    return () => {
      disposed = true;
      clearFeedbackTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      stopCamera();
    };
  }, [restartTick]);

  function retryCamera() {
    setCameraIssue(null);
    setStatus("Initialisation caméra…");
    setRestartTick((tick) => tick + 1);
  }

  async function manualLookup(event: FormEvent) {
    event.preventDefault();
    if (!manualQuery.trim()) return;
    setError(null);
    busyRef.current = true;
    const detectedAt = performance.now();
    let cardRequestStarted = false;
    try {
      if (!navigator.onLine) throw new Error("OFFLINE");
      const response = await fetch(`/api/lookup?q=${encodeURIComponent(manualQuery.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "NOT_FOUND");
      cardRequestStarted = true;
      await loadCardFromToken(`LOY1:${data.token}`, detectedAt, "manual");
    } catch (caught) {
      busyRef.current = false;
      const info = scannerErrorInfo(caught);
      if (!cardRequestStarted) recordPilotEvent("SCAN_FAILED", Math.round(performance.now() - detectedAt), "manual", info.code);
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
      const payload: { token: string; idempotencyKey: string; purchaseAmountCents?: number; overrideReason?: string; expectedLastEarnAt?: string | null } = {
        token: card.token,
        idempotencyKey,
      };
      if (reason) {
        payload.overrideReason = reason;
        payload.expectedLastEarnAt = card.lastEarnAt ?? null;
      }
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
      setCard({ ...card, balance: newBalance, rewardAvailable: newBalance >= card.threshold, lastEarnAt: kind === "credit" ? (data.lastEarnAt ?? new Date().toISOString()) : card.lastEarnAt });
      setRewardJustReached(rewardReached);
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
    setRewardJustReached(false);
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
      <span className="scanner-pill" role="status" aria-live="polite">{online ? status : "Hors ligne"}</span>
      <a className="scanner-pill" href="/s/stats">Stats</a>
    </div>
    <section className="scan-sheet">
      {card ? <div className="scan-result" aria-live="polite">
        <div style={{color:"#aaa"}}>{card.mode === "STAMPS" ? "Tampons" : "Points"} · {card.shortCode}</div>
        <strong>{card.firstName || "Client"}</strong>
        <div style={{fontSize:20}}>{card.balance} / {card.threshold} {card.mode === "STAMPS" ? "tampons" : "points"}</div>
        {card.lastEarnAt && <div style={{color:"#aaa",fontSize:13}}>Dernier passage : {formatLastPassage(card.lastEarnAt)}</div>}
        {rewardJustReached
          ? <div className="scan-success" style={{fontSize:18,fontWeight:900}}>🎁 Récompense débloquée : {card.rewardLabel}</div>
          : card.rewardAvailable && <div className="scan-success">Récompense disponible : {card.rewardLabel}</div>}
        {card.mode === "POINTS" && card.pointsRule === "PER_EURO" && <div className="field">
          <label>Montant achat (€)</label>
          <input className="input" inputMode="decimal" value={purchase} onChange={(event) => setPurchase(event.target.value)} placeholder="12,50" />
        </div>}
        {error && <div className="scan-error" role="alert">
          {error.code === "COOLDOWN" && cooldownRemaining
            ? `Passage déjà enregistré il y a moins de deux minutes. Réessaie dans ${cooldownRemaining} s.`
            : error.message}
          {error.sessionExpired && <div style={{marginTop:8}}><a className="btn" href="/login">Se reconnecter</a></div>}
        </div>}
        {error?.code === "COOLDOWN" && card.canOverrideCooldown && <div className="field">
          <label htmlFor="cooldown-override-reason">Motif obligatoire pour créditer quand même</label>
          <input className="input" id="cooldown-override-reason" value={overrideReason} maxLength={240} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Ex. second achat distinct" />
          <button className="btn btn-danger" disabled={!overrideReason.trim() || Boolean(action)} onClick={() => perform("credit", overrideReason.trim())}>Créditer quand même</button>
        </div>}
        <div className="scan-actions">
          <button className="scan-main" disabled={!online || Boolean(action)} onClick={() => perform("credit")}>{retryingCredit ? "Réessayer sans doublon" : normalCreditLabel}</button>
          <button className="scan-redeem" disabled={!online || !card.rewardAvailable || Boolean(action)} onClick={() => perform("redeem")}>{retryingRedeem ? "Réessayer sans doublon" : "Utiliser récompense"}</button>
        </div>
        <button className="btn" style={{marginTop:10,width:"100%",background:"transparent",color:"white",borderColor:"#444"}} onClick={reset}>Annuler</button>
      </div> : <div>
        <strong style={{fontSize:20}}>{cameraIssue ? CAMERA_ISSUE_INFO[cameraIssue].title : online ? "Présente le QR client" : "Connexion internet requise"}</strong>
        <p style={{margin:"6px 0 12px",color:"#aaa"}}>{cameraIssue ? CAMERA_ISSUE_INFO[cameraIssue].detail : online ? "Cadre le QR dans le viseur : la détection est automatique." : "Aucune action fidélité ne sera envoyée tant que le réseau n’est pas revenu."}</p>
        {cameraIssue && CAMERA_ISSUE_INFO[cameraIssue].retryable && <button className="btn" style={{marginBottom:12}} onClick={retryCamera}>Réessayer la caméra</button>}
        <form onSubmit={manualLookup}>
          <label htmlFor="scanner-manual-query" style={{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0,0,0,0)"}}>Code court ou email du client</label>
          <div style={{display:"flex",gap:8}}>
            <input className="input" id="scanner-manual-query" value={manualQuery} onChange={(event) => setManualQuery(event.target.value)} placeholder="Code court ou email" disabled={!online} />
            <button className="btn" type="submit" disabled={!online}>Chercher</button>
          </div>
        </form>
        {error && <div className="scan-error" role="alert" style={{marginTop:10}}>
          {error.message}
          {error.sessionExpired && <div style={{marginTop:8}}><a className="btn" href="/login">Se reconnecter</a></div>}
        </div>}
        <div style={{marginTop:12}}><PwaInstallHint tone="dark"/></div>
      </div>}
    </section>
  </main>;
}

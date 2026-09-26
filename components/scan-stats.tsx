"use client";
import { useEffect, useMemo, useState } from "react";
import {
  PILOT_GATE,
  PILOT_THRESHOLD_DECISION,
  evaluateP95Thresholds,
  type ScannerDevice,
} from "@/lib/pilot-gate.mjs";
import {
  classifyScanMetrics,
  formatDurationMs,
  nearestRank,
  summarizeDurations,
  type ScanMetric,
} from "@/lib/pilot-field-report.mjs";
import {
  SCAN_METRICS_STORAGE_LIMIT,
  clearScanMetrics,
  createScanMetricsExport,
  loadScanMetrics,
  scanMetricsExportFilename,
  suggestScannerDevice,
} from "@/lib/scan-metrics";
import { summarizeCameraReady } from "@/lib/scanner-camera";

type Feedback = { tone: "success" | "error" | "info"; message: string } | null;

const FEEDBACK_COLORS = { success: "#70d5a5", error: "#f7a79f", info: "#a1a1aa" } as const;

function isIosDevice() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || typeof nav.standalone === "boolean";
}

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(nav.standalone);
}

function downloadJson(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari lit l'URL après le clic : la révoquer immédiatement annulerait le fichier.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ScanStats() {
  const [metrics, setMetrics] = useState<ScanMetric[]>([]);
  const [storedCount, setStoredCount] = useState(0);
  const [device, setDevice] = useState<ScannerDevice | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [manualJson, setManualJson] = useState<string | null>(null);
  const [camera, setCamera] = useState<ReturnType<typeof summarizeCameraReady>>({ count: 0, last: null, median: null, max: null });

  useEffect(() => {
    try {
      const loaded = loadScanMetrics(window.localStorage);
      setMetrics(loaded.metrics);
      setStoredCount(loaded.storedCount);
      setCamera(summarizeCameraReady(window.localStorage));
    } catch {}
    setDevice(suggestScannerDevice(navigator.userAgent));
  }, []);

  const view = useMemo(() => {
    const groups = classifyScanMetrics(metrics);
    return {
      groups,
      actions: summarizeDurations(groups.qrActionsOk.map((metric) => metric.totalMs)),
      lookupP95: nearestRank(groups.qrLookupsOk.map((metric) => metric.totalMs), 95),
      networkP95: nearestRank(groups.qrActionsOk.map((metric) => metric.networkMs), 95),
      serverP95: nearestRank(groups.qrActionsOk.map((metric) => metric.serverMs), 95),
      failures: groups.qrActionsFailed.length + groups.qrLookupsFailed.length,
    };
  }, [metrics]);

  const thresholds = evaluateP95Thresholds(view.actions.p95);
  const seriesCount = view.groups.qrActionsOk.length;
  const discarded = storedCount - metrics.length;

  function prepareExport(selected: ScannerDevice) {
    const data = createScanMetricsExport(window.localStorage, selected);
    const qrActions = classifyScanMetrics(data.metrics).qrActionsOk.length;
    return {
      json: `${JSON.stringify(data, null, 2)}\n`,
      filename: scanMetricsExportFilename(selected),
      summary: `${qrActions} action(s) QR réussie(s), ${data.metrics.length} mesure(s)`,
    };
  }

  async function exportMetrics() {
    if (!device) return;
    let prepared: ReturnType<typeof prepareExport>;
    try {
      prepared = prepareExport(device);
    } catch {
      setFeedback({ tone: "error", message: "Lecture des mesures impossible sur ce navigateur." });
      return;
    }
    const { json, filename, summary } = prepared;
    setManualJson(null);

    // iOS (surtout en PWA installée) télécharge mal un Blob : la feuille de
    // partage permet « Enregistrer dans Fichiers » ou AirDrop vers le Mac.
    const file = typeof File === "function" ? new File([json], filename, { type: "application/json" }) : null;
    const canShareFile = Boolean(file && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }));
    if (file && canShareFile && (isIosDevice() || isStandalone())) {
      try {
        await navigator.share({ files: [file], title: `Mesures scanner Retiko — ${PILOT_GATE.deviceLabels[device]}` });
        setFeedback({ tone: "success", message: `${filename} partagé : ${summary}.` });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setFeedback({ tone: "info", message: "Partage annulé : aucun fichier exporté." });
          return;
        }
      }
    }

    try {
      downloadJson(json, filename);
      setFeedback({ tone: "success", message: `Téléchargement de ${filename} lancé : ${summary}. Si aucun fichier n’apparaît, utilise « Copier le JSON ».` });
    } catch {
      setManualJson(json);
      setFeedback({ tone: "error", message: "Téléchargement impossible : copie le JSON affiché ci-dessous dans un fichier." });
    }
  }

  async function copyJson() {
    if (!device) return;
    let prepared: ReturnType<typeof prepareExport>;
    try {
      prepared = prepareExport(device);
    } catch {
      setFeedback({ tone: "error", message: "Lecture des mesures impossible sur ce navigateur." });
      return;
    }
    try {
      await navigator.clipboard.writeText(prepared.json);
      setManualJson(null);
      setFeedback({ tone: "success", message: `JSON copié (${prepared.summary}) : colle-le dans un fichier ${prepared.filename} sur le Mac.` });
    } catch {
      setManualJson(prepared.json);
      setFeedback({ tone: "error", message: "Copie automatique refusée : sélectionne le JSON ci-dessous puis copie-le." });
    }
  }

  function clearMetrics() {
    if (storedCount > 0 && !window.confirm(`Effacer les ${storedCount} mesure(s) de cet appareil ? Exporte-les d’abord si elles appartiennent à la série terrain.`)) return;
    try {
      clearScanMetrics(window.localStorage);
    } catch {}
    setMetrics([]);
    setStoredCount(0);
    setManualJson(null);
    setFeedback({ tone: "info", message: "Mesures effacées : la série terrain peut commencer." });
  }

  return (
    <div className="grid">
      <div className="card">
        <h3>Série terrain sur cet appareil</h3>
        <p className="muted">{seriesCount} / {PILOT_GATE.actionsPerDevice} actions QR réussies attendues sur ce téléphone scanner, puis export pour le rapport combiné iPhone + Android.</p>
        <p className="muted" style={{ fontSize: 13 }}>Seules les mesures de cette application sont visibles : sur iPhone, la PWA installée et Safari gardent chacune les leurs. Ouvre cette page depuis le bouton Stats du scanner utilisé.</p>
        <fieldset style={{ border: 0, padding: 0, margin: "14px 0 0" }}>
          <legend className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Ce téléphone scanne en tant que</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PILOT_GATE.devices.map((option) => <label key={option} className="btn" style={{ flex: "1 1 0", padding: "0 12px", gap: 6, whiteSpace: "nowrap", cursor: "pointer", borderColor: device === option ? "var(--retiko-coral)" : undefined }}>
              <input type="radio" name="scanner-device" value={option} checked={device === option} onChange={() => setDevice(option)} style={{ margin: 0 }} />
              {PILOT_GATE.deviceLabels[option]}
            </label>)}
          </div>
        </fieldset>
        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn btn-accent" type="button" disabled={!device} onClick={exportMetrics}>Exporter les mesures</button>
          <button className="btn" type="button" disabled={!device} onClick={copyJson}>Copier le JSON</button>
        </div>
        {!device && <p className="muted" style={{ marginTop: 10 }}>Choisis iPhone ou Android pour nommer l’export.</p>}
        {feedback && <p role="status" aria-live="polite" style={{ marginTop: 10, color: FEEDBACK_COLORS[feedback.tone] }}>{feedback.message}</p>}
        {manualJson && <textarea className="textarea" aria-label="JSON des mesures" readOnly value={manualJson} onFocus={(event) => event.currentTarget.select()} style={{ marginTop: 10, minHeight: 180, fontFamily: "monospace", fontSize: 12, background: "#09090b", color: "#fff", borderColor: "#3f3f46" }} />}
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>L’export ne contient que des durées, le résultat et l’horodatage de chaque mesure : aucun QR, aucune donnée client.</p>
        <button className="btn btn-danger" type="button" style={{ marginTop: 6 }} onClick={clearMetrics}>Effacer les mesures</button>
      </div>

      {(view.failures > 0 || view.groups.manual.length > 0 || view.groups.unknownSource.length > 0 || discarded > 0 || storedCount >= SCAN_METRICS_STORAGE_LIMIT) && <div className="card" role="alert">
        {view.failures > 0 && <p style={{ color: FEEDBACK_COLORS.error }}>{view.failures} échec(s) QR enregistré(s) ({view.groups.qrActionsFailed.length} action(s), {view.groups.qrLookupsFailed.length} lookup(s)) : le protocole exige une série sans échec.</p>}
        {view.groups.manual.length > 0 && <p className="muted">{view.groups.manual.length} mesure(s) via saisie manuelle : exclues du critère QR.</p>}
        {view.groups.unknownSource.length > 0 && <p style={{ color: FEEDBACK_COLORS.error }}>{view.groups.unknownSource.length} mesure(s) enregistrée(s) par une version précédente du scanner (origine QR ou manuelle inconnue) : exclues. Efface les mesures avant la série terrain.</p>}
        {discarded > 0 && <p style={{ color: FEEDBACK_COLORS.error }}>{discarded} entrée(s) locale(s) illisible(s) ignorée(s).</p>}
        {storedCount >= SCAN_METRICS_STORAGE_LIMIT && <p style={{ color: FEEDBACK_COLORS.error }}>Limite de {SCAN_METRICS_STORAGE_LIMIT} mesures atteinte : les plus anciennes ont été remplacées.</p>}
      </div>}

      <div className="grid grid-4">
        <div className="card metric"><strong>{seriesCount}</strong><span>actions QR validées</span></div>
        <div className="card metric"><strong>{formatDurationMs(view.actions.p50)}</strong><span>p50 détection → validation</span></div>
        <div className="card metric"><strong>{formatDurationMs(view.actions.p90)}</strong><span>p90 détection → validation</span></div>
        <div className="card metric"><strong>{formatDurationMs(view.actions.p95)}</strong><span>p95 détection → validation</span></div>
      </div>
      <div className="grid grid-4">
        <div className="card metric"><strong>{formatDurationMs(view.actions.max)}</strong><span>max détection → validation</span></div>
        <div className="card metric"><strong>{formatDurationMs(view.lookupP95)}</strong><span>p95 QR → fiche client</span></div>
        <div className="card metric"><strong>{formatDurationMs(view.networkP95)}</strong><span>p95 réseau action</span></div>
        <div className="card metric"><strong>{formatDurationMs(view.serverP95)}</strong><span>p95 serveur action</span></div>
      </div>

      <div className="grid grid-4">
        <div className="card metric"><strong>{formatDurationMs(camera.last)}</strong><span>ouverture caméra (dernière)</span></div>
        <div className="card metric"><strong>{formatDurationMs(camera.median)}</strong><span>ouverture caméra (médiane)</span></div>
        <div className="card metric"><strong>{formatDurationMs(camera.max)}</strong><span>ouverture caméra (max)</span></div>
        <div className="card metric"><strong>{camera.count}</strong><span>ouvertures mesurées (20 dernières)</span></div>
      </div>
      <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Ouverture caméra : de la demande d’accès à la caméra jusqu’au flux prêt à scanner, sur cet appareil. Indicatif : l’ouverture rapide se valide sur le téléphone réel du commerce.</p>

      <div className="card">
        <h3>Critère pilote</h3>
        <p className="muted">{PILOT_GATE.totalActions} actions QR réelles ({PILOT_GATE.actionsPerDevice} avec l’iPhone scanner, {PILOT_GATE.actionsPerDevice} avec l’Android scanner), p95 {PILOT_GATE.criterion} en nearest-rank, et zéro double crédit prouvé côté serveur.</p>
        <ul className="muted" style={{ margin: "10px 0", paddingLeft: 18 }}>
          {thresholds.map((threshold) => <li key={threshold.id}>
            {threshold.label} — {threshold.rule} : {view.actions.p95 === null ? "—" : threshold.pass ? "OUI" : "NON"} <span style={{ fontSize: 12 }}>(cet appareil seul)</span>
          </li>)}
        </ul>
        {PILOT_THRESHOLD_DECISION.status !== "decided" && <p><strong>{PILOT_THRESHOLD_DECISION.summary}.</strong></p>}
        <p className="muted" style={{ marginTop: 10 }}>Le verdict officiel combine les exports iPhone et Android avec <code>npm run pilot:field-report</code>. Les mesures restent locales sur cet appareil ({SCAN_METRICS_STORAGE_LIMIT} dernières) jusqu’à export ou effacement.</p>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";

type Metric = {
  phase?: "lookup" | "action";
  action?: "credit" | "redeem";
  networkMs: number;
  serverMs: number;
  totalMs: number;
  ok: boolean;
  at: string;
};

function pct(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] || 0;
}

export function ScanStats() {
  const [metrics, setMetrics] = useState<Metric[]>([]);

  useEffect(() => {
    try {
      setMetrics(JSON.parse(localStorage.getItem("loyalty_scan_metrics") || "[]"));
    } catch {}
  }, []);

  const { actionTotals, lookupTotals, p95Network, p95Server } = useMemo(() => {
    const actions = metrics.filter((x) => x.phase === "action" && x.ok);
    const lookups = metrics.filter((x) => x.phase === "lookup" && x.ok);
    return {
      actionTotals: actions.map((x) => x.totalMs).filter((x) => Number.isFinite(x) && x >= 0),
      lookupTotals: lookups.map((x) => x.totalMs).filter((x) => Number.isFinite(x) && x >= 0),
      p95Network: pct(actions.map((x) => x.networkMs), 95),
      p95Server: pct(actions.map((x) => x.serverMs), 95),
    };
  }, [metrics]);

  return (
    <div className="grid">
      <div className="grid grid-4">
        <div className="card metric"><strong>{actionTotals.length}</strong><span>actions validées</span></div>
        <div className="card metric"><strong>{pct(actionTotals, 50)} ms</strong><span>p50 détection → validation</span></div>
        <div className="card metric"><strong>{pct(actionTotals, 95)} ms</strong><span>p95 détection → validation</span></div>
        <div className="card metric"><strong>{actionTotals.length ? Math.max(...actionTotals) : 0} ms</strong><span>max</span></div>
      </div>
      <div className="grid grid-3">
        <div className="card metric"><strong>{pct(lookupTotals, 95)} ms</strong><span>p95 QR → fiche client</span></div>
        <div className="card metric"><strong>{p95Network} ms</strong><span>p95 réseau action</span></div>
        <div className="card metric"><strong>{p95Server} ms</strong><span>p95 serveur action</span></div>
      </div>
      <div className="card"><h3>Critère pilote</h3><p className="muted">30 actions réelles, p95 détection QR → validation &lt; 2 500 ms et zéro double crédit. Les mesures restent locales sur cet appareil, limitées aux 50 dernières.</p><button className="btn btn-danger" onClick={() => { localStorage.removeItem("loyalty_scan_metrics"); setMetrics([]); }}>Effacer les mesures</button></div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CardLiveStatusProps = {
  token: string;
  initialBalance: number;
  initialThreshold: number;
  initialUpdatedAt: string;
  mode: "STAMPS" | "POINTS";
  rewardLabel: string;
};

type CardStatus = {
  balance: number;
  threshold: number;
  rewardAvailable: boolean;
  updatedAt: string;
};

const POLL_MS = 3_000;
const ACTIVE_MS = 5 * 60_000;

export function CardLiveStatus({ token, initialBalance, initialThreshold, initialUpdatedAt, mode, rewardLabel }: CardLiveStatusProps) {
  const [status, setStatus] = useState<CardStatus>({
    balance: initialBalance,
    threshold: initialThreshold,
    rewardAvailable: initialBalance >= initialThreshold,
    updatedAt: initialUpdatedAt,
  });
  const [idle, setIdle] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  const lastInteraction = useRef(Date.now());

  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const response = await fetch("/api/card/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      if (response.status === 404) {
        // La carte a été révoquée (établissement suspendu, carte effacée/expirée)
        // pendant que cet onglet restait ouvert : recharger refait passer par
        // notFound() côté serveur plutôt que de laisser un solde figé paraître
        // toujours valide.
        window.location.reload();
        return;
      }
      if (!response.ok) return;
      const next = await response.json() as CardStatus;
      setStatus((previous) => {
        if (next.balance !== previous.balance) {
          setJustUpdated(true);
          window.setTimeout(() => setJustUpdated(false), 2_500);
        }
        return next;
      });
    } catch {
      // La carte conserve le dernier solde connu quand le téléphone passe
      // brièvement hors ligne. Le prochain tick visible retentera la lecture.
    }
  }, [token]);

  const resume = useCallback(() => {
    lastInteraction.current = Date.now();
    setIdle(false);
  }, []);

  useEffect(() => {
    const onInteraction = () => resume();
    window.addEventListener("pointerdown", onInteraction, { passive: true });
    window.addEventListener("keydown", onInteraction);
    return () => {
      window.removeEventListener("pointerdown", onInteraction);
      window.removeEventListener("keydown", onInteraction);
    };
  }, [resume]);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearInterval(timer);
      if (document.visibilityState !== "visible" || idle) return;
      timer = window.setInterval(() => {
        if (Date.now() - lastInteraction.current >= ACTIVE_MS) {
          setIdle(true);
          return;
        }
        void refresh();
      }, POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !idle) void refresh();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [idle, refresh]);

  const percent = Math.min(100, Math.round((status.balance / status.threshold) * 100));
  const remaining = Math.max(0, status.threshold - status.balance);
  const unit = mode === "STAMPS" ? "tampon" : "point";

  return <div aria-live="polite">
    <div style={{fontSize:44,fontWeight:950,letterSpacing:"-.05em",transition:"opacity .2s",opacity: justUpdated ? .55 : 1}}>{status.balance} / {status.threshold}</div>
    <div style={{opacity:.85}}>{unit}{status.balance > 1 ? "s" : ""}</div>
    <div className="progress" style={{marginTop:12}}><span style={{width:`${percent}%`}}/></div>
    <p style={{margin:"12px 0 0",opacity:.9}}>
      {status.rewardAvailable ? `Récompense disponible : ${rewardLabel}` : `Encore ${remaining} ${unit}${remaining > 1 ? "s" : ""} avant votre récompense`}
    </p>
    {justUpdated ? <p style={{margin:"8px 0 0",opacity:.9,fontWeight:800}}>✓ Solde mis à jour</p> : null}
    {idle ? <button className="btn" style={{marginTop:12}} onClick={() => { resume(); void refresh(); }}>Actualiser mon solde</button> : null}
  </div>;
}

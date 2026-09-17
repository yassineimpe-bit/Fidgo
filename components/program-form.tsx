"use client";
import { FormEvent, useState } from "react";

export type Program = {
  program_name: string;
  mode: "STAMPS" | "POINTS";
  points_rule?: "PER_PURCHASE" | "PER_EURO";
  reward_threshold: number;
  reward_label: string;
  stamps_per_visit: number;
  points_per_purchase: number;
  points_per_euro: number;
  daily_earn_limit: number;
  cooldown_seconds: number;
  expires_after_days?: number | null;
  card_message?: string | null;
};

export function ProgramForm({ program }: { program: Program }) {
  const [mode, setMode] = useState(program.mode || "STAMPS");
  const [pointsRule, setPointsRule] = useState(program.points_rule || "PER_PURCHASE");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setMsg("");
    const f = new FormData(e.currentTarget);
    const payload = { programName:f.get("programName"), mode, pointsRule, rewardThreshold:Number(f.get("rewardThreshold")), rewardLabel:f.get("rewardLabel"), stampsPerVisit:Number(f.get("stampsPerVisit")), pointsPerPurchase:Number(f.get("pointsPerPurchase")), pointsPerEuro:Number(f.get("pointsPerEuro")), dailyEarnLimit:Number(f.get("dailyEarnLimit")), cooldownSeconds:Number(f.get("cooldownSeconds")), expiresAfterDays:f.get("expiresAfterDays")?Number(f.get("expiresAfterDays")):null, cardMessage:f.get("cardMessage") };
    try {
      const r = await fetch("/api/program", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
      setMsg(r.ok ? "Programme enregistré." : "Impossible d’enregistrer.");
    } catch {
      // Sans ce filet, une coupure réseau pendant l'envoi laissait le bouton
      // bloqué sur "Enregistrement…" indéfiniment.
      setMsg("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return <form className="form" onSubmit={submit}>
    <div className="grid grid-2"><div className="field"><label htmlFor="program-name">Nom du programme</label><input className="input" id="program-name" name="programName" defaultValue={program.program_name}/></div><div className="field"><label htmlFor="program-mode">Mode</label><select className="select" id="program-mode" value={mode} onChange={e=>setMode(e.target.value as "STAMPS"|"POINTS")}><option value="STAMPS">Tampons</option><option value="POINTS">Points</option></select></div></div>
    <div className="grid grid-2"><div className="field"><label htmlFor="program-threshold">Seuil de récompense</label><input className="input" id="program-threshold" type="number" min="1" name="rewardThreshold" defaultValue={program.reward_threshold}/></div><div className="field"><label htmlFor="program-reward-label">Récompense</label><input className="input" id="program-reward-label" name="rewardLabel" defaultValue={program.reward_label}/></div></div>
    {mode === "STAMPS" ? <div className="field"><label htmlFor="program-stamps-per-visit">Tampons par passage</label><input className="input" id="program-stamps-per-visit" type="number" min="1" name="stampsPerVisit" defaultValue={program.stamps_per_visit}/><input type="hidden" name="pointsPerPurchase" value={program.points_per_purchase || 1}/><input type="hidden" name="pointsPerEuro" value={Number(program.points_per_euro) || 1}/></div> : <><div className="field"><label htmlFor="program-points-rule">Calcul des points</label><select className="select" id="program-points-rule" value={pointsRule} onChange={e=>setPointsRule(e.target.value as "PER_PURCHASE"|"PER_EURO")}><option value="PER_PURCHASE">Points fixes par achat</option><option value="PER_EURO">Points selon le montant dépensé</option></select></div>{pointsRule === "PER_PURCHASE" ? <div className="field"><label htmlFor="program-points-per-purchase">Points par achat</label><input className="input" id="program-points-per-purchase" type="number" min="1" name="pointsPerPurchase" defaultValue={program.points_per_purchase}/><input type="hidden" name="pointsPerEuro" value={Number(program.points_per_euro) || 1}/></div> : <div className="field"><label htmlFor="program-points-per-euro">Points par euro</label><input className="input" id="program-points-per-euro" type="number" min="0.01" step="0.01" name="pointsPerEuro" defaultValue={Number(program.points_per_euro) || 1}/><input type="hidden" name="pointsPerPurchase" value={program.points_per_purchase || 1}/></div>}<input type="hidden" name="stampsPerVisit" value={program.stamps_per_visit || 1}/></>}
    <div className="grid grid-3"><div className="field"><label htmlFor="program-daily-limit">Limite unités / jour</label><input className="input" id="program-daily-limit" type="number" min="0" name="dailyEarnLimit" defaultValue={program.daily_earn_limit}/><small>0 = illimité</small></div><div className="field"><label htmlFor="program-cooldown">Cooldown (secondes)</label><input className="input" id="program-cooldown" type="number" min="0" name="cooldownSeconds" defaultValue={program.cooldown_seconds}/></div><div className="field"><label htmlFor="program-expires">Expiration (jours)</label><input className="input" id="program-expires" type="number" min="1" name="expiresAfterDays" defaultValue={program.expires_after_days || ""}/></div></div>
    <div className="field"><label htmlFor="program-card-message">Message carte</label><textarea className="textarea" id="program-card-message" name="cardMessage" maxLength={240} defaultValue={program.card_message || ""}/></div>
    {msg && <div className={`notice ${msg.includes("enregistré")?"success":"error"}`} role={msg.includes("enregistré")?undefined:"alert"}>{msg}</div>}<button className="btn btn-primary" disabled={loading}>{loading?"Enregistrement…":"Enregistrer"}</button>
  </form>;
}

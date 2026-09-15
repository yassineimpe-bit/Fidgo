"use client";
import { FormEvent, useState } from "react";

type Program = {
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
    e.preventDefault();
    setLoading(true);
    setMsg("");
    const f = new FormData(e.currentTarget);
    const payload = {
      programName: f.get("programName"),
      mode,
      pointsRule,
      rewardThreshold: Number(f.get("rewardThreshold")),
      rewardLabel: f.get("rewardLabel"),
      stampsPerVisit: Number(f.get("stampsPerVisit")),
      pointsPerPurchase: Number(f.get("pointsPerPurchase")),
      pointsPerEuro: Number(f.get("pointsPerEuro")),
      dailyEarnLimit: Number(f.get("dailyEarnLimit")),
      cooldownSeconds: Number(f.get("cooldownSeconds")),
      expiresAfterDays: f.get("expiresAfterDays") ? Number(f.get("expiresAfterDays")) : null,
      cardMessage: f.get("cardMessage"),
    };
    const r = await fetch("/api/program", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setLoading(false);
    setMsg(r.ok ? "Programme enregistré." : "Impossible d’enregistrer.");
  }

  return <form className="form" onSubmit={submit}>
    <div className="grid grid-2"><div className="field"><label>Nom du programme</label><input className="input" name="programName" defaultValue={program.program_name}/></div><div className="field"><label>Mode</label><select className="select" value={mode} onChange={e=>setMode(e.target.value as "STAMPS"|"POINTS")}><option value="STAMPS">Tampons</option><option value="POINTS">Points</option></select></div></div>
    <div className="grid grid-2"><div className="field"><label>Seuil de récompense</label><input className="input" type="number" min="1" name="rewardThreshold" defaultValue={program.reward_threshold}/></div><div className="field"><label>Récompense</label><input className="input" name="rewardLabel" defaultValue={program.reward_label}/></div></div>
    {mode === "STAMPS" ? <div className="field"><label>Tampons par passage</label><input className="input" type="number" min="1" name="stampsPerVisit" defaultValue={program.stamps_per_visit}/><input type="hidden" name="pointsPerPurchase" value={program.points_per_purchase || 1}/><input type="hidden" name="pointsPerEuro" value={program.points_per_euro || 1}/></div> : <>
      <div className="field"><label>Calcul des points</label><select className="select" value={pointsRule} onChange={e=>setPointsRule(e.target.value as "PER_PURCHASE"|"PER_EURO")}><option value="PER_PURCHASE">Points fixes par achat</option><option value="PER_EURO">Points selon le montant dépensé</option></select></div>
      {pointsRule === "PER_PURCHASE" ? <div className="field"><label>Points par achat</label><input className="input" type="number" min="1" name="pointsPerPurchase" defaultValue={program.points_per_purchase}/><input type="hidden" name="pointsPerEuro" value={program.points_per_euro || 1}/></div> : <div className="field"><label>Points par euro</label><input className="input" type="number" min="0.01" step="0.01" name="pointsPerEuro" defaultValue={program.points_per_euro || 1}/><input type="hidden" name="pointsPerPurchase" value={program.points_per_purchase || 1}/></div>}
      <input type="hidden" name="stampsPerVisit" value={program.stamps_per_visit || 1}/>
    </>}
    <div className="grid grid-3"><div className="field"><label>Limite unités / jour</label><input className="input" type="number" min="0" name="dailyEarnLimit" defaultValue={program.daily_earn_limit}/><small>0 = illimité</small></div><div className="field"><label>Cooldown (secondes)</label><input className="input" type="number" min="0" name="cooldownSeconds" defaultValue={program.cooldown_seconds}/></div><div className="field"><label>Expiration (jours)</label><input className="input" type="number" min="1" name="expiresAfterDays" defaultValue={program.expires_after_days || ""}/></div></div>
    <div className="field"><label>Message carte</label><textarea className="textarea" name="cardMessage" maxLength={240} defaultValue={program.card_message || ""}/></div>
    {msg && <div className={`notice ${msg.includes("enregistré")?"success":"error"}`}>{msg}</div>}
    <button className="btn btn-primary" disabled={loading}>{loading?"Enregistrement…":"Enregistrer"}</button>
  </form>;
}

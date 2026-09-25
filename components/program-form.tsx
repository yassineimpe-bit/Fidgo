"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandPreview, type BrandPreviewProps } from "@/components/brand-preview";
import { COOLDOWN_PRESETS, MAX_COOLDOWN_SECONDS, formatCooldown } from "@/lib/cooldown";
import { defaultUnits, programUnits } from "@/lib/program-units";

/**
 * Délai entre deux crédits : préréglages en minutes, valeur libre en secondes.
 * Une valeur existante hors préréglage (ex. 90 s) s'ouvre en « Personnalisé »
 * et n'est jamais arrondie à l'enregistrement.
 */
function CooldownField({ initialSeconds }: { initialSeconds: number }) {
  const isPreset = (COOLDOWN_PRESETS as readonly number[]).includes(initialSeconds);
  const [choice, setChoice] = useState(isPreset ? String(initialSeconds) : "custom");
  const [custom, setCustom] = useState(String(initialSeconds));
  const seconds = choice === "custom" ? custom : choice;
  const parsed = Number(seconds);
  return <div className="field">
    <label htmlFor="program-cooldown-preset">Délai entre deux crédits</label>
    <select className="select" id="program-cooldown-preset" value={choice} onChange={(event) => setChoice(event.target.value)}>
      {COOLDOWN_PRESETS.map((value) => <option key={value} value={value}>{formatCooldown(value)}</option>)}
      <option value="custom">Personnalisé</option>
    </select>
    {choice === "custom" && <>
      <label htmlFor="program-cooldown">Délai personnalisé (secondes)</label>
      <input className="input" id="program-cooldown" type="number" min="0" max={MAX_COOLDOWN_SECONDS} required value={custom} onChange={(event) => setCustom(event.target.value)}/>
    </>}
    <input type="hidden" name="cooldownSeconds" value={seconds}/>
    <small>{Number.isFinite(parsed) && parsed >= 0 ? `Soit ${formatCooldown(parsed)}. ` : ""}Un responsable peut autoriser un nouvel achat pendant ce délai.</small>
  </div>;
}

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
  unit_label?: string | null;
  unit_label_plural?: string | null;
};

export function ProgramForm({ program, preview, onboarding = false }: { program: Program; preview?: Omit<BrandPreviewProps, "rewardThreshold" | "rewardLabel" | "unit">; onboarding?: boolean }) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(String(program.reward_threshold));
  const [reward, setReward] = useState(program.reward_label);
  const [mode, setMode] = useState(program.mode || "STAMPS");
  const [pointsRule, setPointsRule] = useState(program.points_rule || "PER_PURCHASE");
  const [unitLabel, setUnitLabel] = useState(program.unit_label || "");
  const [unitLabelPlural, setUnitLabelPlural] = useState(program.unit_label_plural || "");
  const units = programUnits(mode, unitLabel, unitLabelPlural);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setLoading(true); setMsg("");
    const f = new FormData(e.currentTarget);
    const payload = { onboarding, programName:f.get("programName"), mode, pointsRule, rewardThreshold:Number(f.get("rewardThreshold")), rewardLabel:f.get("rewardLabel"), stampsPerVisit:Number(f.get("stampsPerVisit")), pointsPerPurchase:Number(f.get("pointsPerPurchase")), pointsPerEuro:Number(f.get("pointsPerEuro")), dailyEarnLimit:Number(f.get("dailyEarnLimit")), cooldownSeconds:Number(f.get("cooldownSeconds")), expiresAfterDays:f.get("expiresAfterDays")?Number(f.get("expiresAfterDays")):null, cardMessage:f.get("cardMessage"), unitLabel, unitLabelPlural };
    try {
      const r = await fetch("/api/program", { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify(payload) });
      const error = r.ok ? "" : String((await r.json().catch(() => ({}))).error || "");
      setMsg(r.ok ? "Programme enregistré." : error === "INVALID_UNIT_LABEL"
        ? "Libellé d’unité invalide : lettres, espaces, apostrophes et tirets, 24 caractères au plus."
        : error === "UNIT_LABEL_UNAVAILABLE"
          ? "Le libellé personnalisé n’est pas encore disponible sur ce serveur."
          : "Impossible d’enregistrer. Vérifie les valeurs du programme.");
      if (r.ok && onboarding) { router.push("/onboarding?step=3"); router.refresh(); }
    } catch {
      // Sans ce filet, une coupure réseau pendant l'envoi laissait le bouton
      // bloqué sur "Enregistrement…" indéfiniment.
      setMsg("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return <div className={preview ? "grid grid-2" : undefined} style={{alignItems:"start"}}><form className="form" onSubmit={submit}>
    <div className="grid grid-2"><div className="field"><label htmlFor="program-name">Nom du programme</label><input className="input" id="program-name" name="programName" required maxLength={120} defaultValue={program.program_name}/></div><div className="field"><label htmlFor="program-mode">Mode</label><select className="select" id="program-mode" value={mode} onChange={e=>setMode(e.target.value as "STAMPS"|"POINTS")}><option value="STAMPS">Tampons</option><option value="POINTS">Points</option></select></div></div>
    <div className="grid grid-2"><div className="field"><label htmlFor="program-threshold">Seuil de récompense</label><input className="input" id="program-threshold" type="number" min="1" max="100000" required name="rewardThreshold" value={threshold} onChange={e=>setThreshold(e.target.value)}/></div><div className="field"><label htmlFor="program-reward-label">Récompense</label><input className="input" id="program-reward-label" name="rewardLabel" required maxLength={180} value={reward} onChange={e=>setReward(e.target.value)}/></div></div>
    {mode === "STAMPS" ? <div className="field"><label htmlFor="program-stamps-per-visit">Tampons par passage</label><input className="input" id="program-stamps-per-visit" type="number" min="1" name="stampsPerVisit" defaultValue={program.stamps_per_visit}/><input type="hidden" name="pointsPerPurchase" value={program.points_per_purchase || 1}/><input type="hidden" name="pointsPerEuro" value={Number(program.points_per_euro) || 1}/></div> : <><div className="field"><label htmlFor="program-points-rule">Calcul des points</label><select className="select" id="program-points-rule" value={pointsRule} onChange={e=>setPointsRule(e.target.value as "PER_PURCHASE"|"PER_EURO")}><option value="PER_PURCHASE">Points fixes par achat</option><option value="PER_EURO">Points selon le montant dépensé</option></select></div>{pointsRule === "PER_PURCHASE" ? <div className="field"><label htmlFor="program-points-per-purchase">Points par achat</label><input className="input" id="program-points-per-purchase" type="number" min="1" name="pointsPerPurchase" defaultValue={program.points_per_purchase}/><input type="hidden" name="pointsPerEuro" value={Number(program.points_per_euro) || 1}/></div> : <div className="field"><label htmlFor="program-points-per-euro">Points par euro</label><input className="input" id="program-points-per-euro" type="number" min="0.01" step="0.01" name="pointsPerEuro" defaultValue={Number(program.points_per_euro) || 1}/><input type="hidden" name="pointsPerPurchase" value={program.points_per_purchase || 1}/></div>}<input type="hidden" name="stampsPerVisit" value={program.stamps_per_visit || 1}/></>}
    <div className="grid grid-3"><div className="field"><label htmlFor="program-daily-limit">Limite unités / jour</label><input className="input" id="program-daily-limit" type="number" min="0" name="dailyEarnLimit" defaultValue={program.daily_earn_limit}/><small>0 = illimité</small></div><CooldownField initialSeconds={Number(program.cooldown_seconds)}/><div className="field"><label htmlFor="program-expires">Expiration (jours)</label><input className="input" id="program-expires" type="number" min="1" name="expiresAfterDays" defaultValue={program.expires_after_days || ""}/></div></div>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="program-unit-label">Nom de l’unité</label><input className="input" id="program-unit-label" maxLength={24} value={unitLabel} onChange={e=>setUnitLabel(e.target.value)} placeholder={defaultUnits(mode).singular}/><small className="muted">Facultatif, ex. « café ». Vide = {defaultUnits(mode).singular}.</small></div>
      <div className="field"><label htmlFor="program-unit-label-plural">Au pluriel</label><input className="input" id="program-unit-label-plural" maxLength={24} value={unitLabelPlural} onChange={e=>setUnitLabelPlural(e.target.value)} placeholder={units.plural} disabled={!unitLabel.trim()}/><small className="muted">Si différent de « {units.singular}s ».</small></div>
    </div>
    <div className="field"><label htmlFor="program-card-message">Message carte</label><textarea className="textarea" id="program-card-message" name="cardMessage" maxLength={240} defaultValue={program.card_message || ""}/></div>
    {msg && <div className={`notice ${msg.includes("enregistré")?"success":"error"}`} role={msg.includes("enregistré")?undefined:"alert"}>{msg}</div>}<button className="btn btn-primary" disabled={loading}>{loading?"Enregistrement…":onboarding?"Enregistrer et continuer":"Enregistrer"}</button>
  </form>{preview && <aside className="card"><h3>Aperçu de ta carte</h3><BrandPreview {...preview} rewardThreshold={Number(threshold) || 0} rewardLabel={reward} unit={units.plural}/></aside>}</div>;
}

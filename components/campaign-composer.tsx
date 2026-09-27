"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Kind = "promotion" | "inactive_reminder";
type Segment = "all" | "active" | "reward_available";
type Progress = { status: string; recipientCount: number; sentCount: number; failedCount: number; skippedCount: number; pending: number };

const ERRORS: Record<string, string> = {
  NO_RECIPIENTS: "Aucun client à contacter pour ce ciblage (consentement, adresse e-mail ou e-mail reçu il y a moins de 7 jours).",
  EMAIL_NOT_CONFIGURED: "L’envoi d’e-mails n’est pas encore configuré sur Retiko.",
  CAMPAIGNS_UNAVAILABLE: "Les campagnes ne sont pas encore disponibles. Réessayez plus tard.",
  INVALID_FIELD: "Vérifiez l’objet et le message.",
  FORBIDDEN: "Votre rôle ne permet pas d’envoyer une campagne.",
};

function errorMessage(status: number, body: { error?: string; retryAt?: string } | null) {
  if (body?.error === "CAMPAIGN_LIMIT") {
    const date = body.retryAt ? new Date(body.retryAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
    return `Limite atteinte : 2 campagnes par période de 7 jours.${date ? ` Prochaine campagne possible le ${date}.` : ""}`;
  }
  if (status === 429) return "Trop de demandes. Patientez quelques minutes.";
  return (body?.error && ERRORS[body.error]) || "Impossible d’envoyer la campagne pour le moment.";
}

/** Envoie les lots jusqu'à épuisement ; renvoie la progression finale ou un message d'erreur. */
export async function runCampaign(id: string, onProgress: (progress: Progress) => void): Promise<string | null> {
  for (let round = 0; round < 500; round += 1) {
    const response = await fetch(`/api/campaigns/${id}/send`, { method: "POST" });
    const body = await response.json().catch(() => null);
    if (!response.ok) return errorMessage(response.status, body);
    onProgress(body as Progress);
    if ((body as Progress).pending === 0) return null;
  }
  return "Envoi interrompu. Reprenez-le depuis l’historique.";
}

export function progressText(progress: Progress) {
  const done = progress.sentCount + progress.failedCount + progress.skippedCount;
  return `${done} / ${progress.recipientCount} traité(s) · ${progress.sentCount} envoyé(s)${progress.failedCount ? ` · ${progress.failedCount} échec(s)` : ""}${progress.skippedCount ? ` · ${progress.skippedCount} désabonné(s) entre-temps` : ""}`;
}

const SEGMENT_LABELS: Record<Segment, string> = {
  all: "Tous les clients abonnés",
  active: "Clients venus ces 30 derniers jours",
  reward_available: "Clients avec une récompense disponible",
};

/** Ciblage lisible repris tel quel dans la confirmation d'envoi. */
export function audienceLabel(kind: Kind, segment: Segment, inactiveDays: number) {
  return kind === "inactive_reminder"
    ? `Relance des clients inactifs · sans visite depuis ${inactiveDays} jours`
    : `Campagne promotionnelle · ${SEGMENT_LABELS[segment]}`;
}

async function fetchRecipients(audienceKey: string): Promise<number | null> {
  const response = await fetch("/api/campaigns/preview", { method: "POST", headers: { "content-type": "application/json" }, body: audienceKey });
  const body = await response.json().catch(() => null);
  return response.ok ? Number(body.recipients) : null;
}

export function CampaignComposer({ restaurantName }: { restaurantName: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("promotion");
  const [segment, setSegment] = useState<Segment>("all");
  const [inactiveDays, setInactiveDays] = useState(60);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [recipients, setRecipients] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const idempotencyKey = useRef("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmTitleRef = useRef<HTMLHeadingElement>(null);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  // Nombre recalculé à l'ouverture de la confirmation : undefined = calcul en cours.
  const [confirming, setConfirming] = useState<{ recipients: number | null | undefined } | null>(null);

  const audience = kind === "inactive_reminder" ? { segment: "inactive", inactiveDays } : { segment };
  const audienceKey = JSON.stringify(audience);

  useEffect(() => {
    let cancelled = false;
    setRecipients(null);
    fetchRecipients(audienceKey)
      .then((count) => { if (!cancelled) setRecipients(count); })
      .catch(() => { if (!cancelled) setRecipients(null); });
    return () => { cancelled = true; };
  }, [audienceKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirming && !dialog.open) { dialog.showModal(); confirmTitleRef.current?.focus(); }
    if (!confirming && dialog.open) dialog.close();
  }, [confirming]);

  // Étape 1 : aucune campagne n'est créée, on recalcule l'audience et on récapitule.
  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!recipients || busy) return;
    setError("");
    setConfirming({ recipients: undefined });
    try {
      const count = await fetchRecipients(audienceKey);
      setRecipients(count);
      setConfirming((current) => current ? { recipients: count } : current);
    } catch {
      setConfirming((current) => current ? { recipients: null } : current);
    }
  }

  function closeConfirmation() {
    setConfirming(null);
    window.requestAnimationFrame(() => sendButtonRef.current?.focus());
  }

  // Étape 2 : flow d'envoi existant, inchangé (clé d'idempotence, lots, reprise).
  async function send() {
    if (!confirming?.recipients || busy) return;
    setConfirming(null);
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(null);
    idempotencyKey.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ...audience, subject, message, idempotencyKey: idempotencyKey.current }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(errorMessage(response.status, body)); return; }
      const failure = await runCampaign(String(body.id), setProgress);
      if (failure) { setError(failure); return; }
      idempotencyKey.current = "";
      setSubject("");
      setMessage("");
      setNotice("Campagne envoyée.");
    } catch {
      setError("Connexion perdue. Si la campagne apparaît dans l’historique, reprenez son envoi.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return <><form className="card form" onSubmit={review} aria-label="Nouvelle campagne">
    <h3>Nouvelle campagne e-mail</h3>
    <fieldset className="form" style={{border:0,padding:0,margin:0}}>
      <legend className="muted">Type</legend>
      <label className="check-row"><input type="radio" name="kind" checked={kind === "promotion"} onChange={() => setKind("promotion")}/><span>Campagne promotionnelle</span></label>
      <label className="check-row"><input type="radio" name="kind" checked={kind === "inactive_reminder"} onChange={() => setKind("inactive_reminder")}/><span>Relance des clients inactifs</span></label>
    </fieldset>
    {kind === "promotion"
      ? <label>Clients ciblés<select className="input" value={segment} onChange={(event) => setSegment(event.target.value as Segment)}>
          <option value="all">Tous les clients abonnés</option>
          <option value="active">Clients venus ces 30 derniers jours</option>
          <option value="reward_available">Clients avec une récompense disponible</option>
        </select></label>
      : <label>Sans visite depuis<select className="input" value={inactiveDays} onChange={(event) => setInactiveDays(Number(event.target.value))}>
          <option value={30}>30 jours</option>
          <option value={60}>60 jours</option>
          <option value={90}>90 jours</option>
        </select></label>}
    <p className="muted" role="status" aria-live="polite">{recipients === null ? "Calcul des destinataires…" : `${recipients} client(s) recevront cet e-mail.`}</p>
    <label>Objet<input className="input" value={subject} maxLength={120} required onChange={(event) => setSubject(event.target.value)} placeholder={`Une surprise vous attend chez ${restaurantName}`}/></label>
    <label>Message<textarea className="input" value={message} maxLength={2000} rows={6} required onChange={(event) => setMessage(event.target.value)}/></label>
    <p className="muted" style={{margin:0}}>Un lien de désabonnement et le nom du commerce sont ajoutés automatiquement en bas de l’e-mail.</p>
    <button ref={sendButtonRef} className="btn btn-primary" type="submit" disabled={busy || !recipients || !subject.trim() || !message.trim()}>
      {busy ? "Envoi en cours…" : recipients ? `Envoyer à ${recipients} client(s)` : "Aucun destinataire"}
    </button>
    {progress && <p className="muted" role="status">{progressText(progress)}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </form>
  <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="campaign-confirm-title"
    onCancel={(event) => { event.preventDefault(); closeConfirmation(); }}>
    <h3 id="campaign-confirm-title" ref={confirmTitleRef} tabIndex={-1} style={{marginTop:0}}>Confirmer l’envoi de la campagne ?</h3>
    <dl className="confirm-summary">
      <div><dt>Ciblage</dt><dd>{audienceLabel(kind, segment, inactiveDays)}</dd></div>
      <div><dt>Objet</dt><dd>{subject}</dd></div>
      <div><dt>Destinataires</dt><dd>{confirming?.recipients === undefined ? "Calcul en cours…" : confirming?.recipients ? `${confirming.recipients} client${confirming.recipients > 1 ? "s" : ""}` : "Aucun"}</dd></div>
    </dl>
    {confirming?.recipients === 0 && <p className="notice error" role="alert">{ERRORS.NO_RECIPIENTS}</p>}
    {confirming?.recipients === null && <p className="notice error" role="alert">Impossible de vérifier les destinataires. Réessaie dans un instant.</p>}
    <p className="notice"><strong>Envoi définitif :</strong> un e-mail parti ne peut pas être rappelé.</p>
    <div className="actions">
      <button className="btn btn-primary" type="button" disabled={!confirming?.recipients} onClick={() => void send()}>
        {confirming?.recipients ? `Confirmer l’envoi à ${confirming.recipients} client${confirming.recipients > 1 ? "s" : ""}` : "Confirmer l’envoi"}
      </button>
      <button className="btn" type="button" onClick={closeConfirmation}>Annuler</button>
    </div>
  </dialog></>;
}

export function CampaignResumeButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  async function resume() {
    setBusy(true);
    setText("");
    try {
      const failure = await runCampaign(id, (progress) => setText(progressText(progress)));
      if (failure) setText(failure);
    } catch {
      setText("Connexion perdue. Réessayez.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return <span><button className="btn" type="button" onClick={resume} disabled={busy}>{busy ? "Envoi…" : "Reprendre l’envoi"}</button>{text && <span className="muted" role="status"> {text}</span>}</span>;
}

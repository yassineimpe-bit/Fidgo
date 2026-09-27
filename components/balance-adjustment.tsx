"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ADJUST_REASON_MAX,
  ADJUSTMENT_ERRORS,
  ADJUSTMENT_NETWORK_MESSAGE,
  ADJUSTMENT_SUCCESS_MESSAGE,
  adjustmentErrorMessage,
  checkAdjustment,
  describeVariation,
} from "@/lib/balance-adjustment";
import { formatUnits, type ProgramUnits } from "@/lib/program-units";

type Step = "edit" | "confirm";
type Planned = { oldBalance: number; variation: number; newBalance: number; reason: string };

/**
 * Régularisation d'une opération absente (crédit oublié pendant une panne…).
 * Distincte de l'annulation, qui compense une transaction existante : ici une
 * écriture « adjust » est ajoutée au ledger, rien n'est modifié ni supprimé.
 */
export function BalanceAdjustment({ customerId, customerName, balance, units }: {
  customerId: string;
  customerName: string;
  balance: number;
  units: ProgramUnits;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const variationRef = useRef<HTMLInputElement>(null);
  const confirmTitleRef = useRef<HTMLHeadingElement>(null);
  // Même clé pour toutes les tentatives d'une même opération : un retry après
  // réponse perdue ne crée jamais une seconde écriture.
  const keyRef = useRef<string | null>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("edit");
  const [currentBalance, setCurrentBalance] = useState(balance);
  const [variation, setVariation] = useState("");
  const [reason, setReason] = useState("");
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [networkLost, setNetworkLost] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => setCurrentBalance(balance), [balance]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (step === "edit") variationRef.current?.focus();
    else confirmTitleRef.current?.focus();
  }, [open, step]);

  // Aperçu du nouveau solde dès la saisie de la variation, motif encore vide ou non.
  const preview = checkAdjustment(currentBalance, variation, "aperçu");

  function newOperation() {
    keyRef.current = null;
    setNetworkLost(false);
  }

  function openDialog() {
    setSuccess("");
    setError("");
    setVariation("");
    setReason("");
    setPlanned(null);
    setStep("edit");
    newOperation();
    setOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    setOpen(false);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }

  function review(event: FormEvent) {
    event.preventDefault();
    const check = checkAdjustment(currentBalance, variation, reason);
    if (!check.ok) {
      setError(ADJUSTMENT_ERRORS[check.error]);
      return;
    }
    const next = { ...check, reason: reason.trim() };
    if (!planned || planned.newBalance !== next.newBalance || planned.reason !== next.reason || planned.oldBalance !== next.oldBalance) {
      newOperation();
    }
    setPlanned(next);
    setError("");
    setStep("confirm");
  }

  async function submit() {
    if (!planned || busy) return;
    if (!keyRef.current) keyRef.current = crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/customers/${customerId}/adjust`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          newBalance: planned.newBalance,
          expectedBalance: planned.oldBalance,
          reason: planned.reason,
          idempotencyKey: keyRef.current,
        }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; balance?: number };
      if (response.ok) {
        newOperation();
        setCurrentBalance(Number(data.balance ?? planned.newBalance));
        setOpen(false);
        setSuccess(ADJUSTMENT_SUCCESS_MESSAGE);
        router.refresh();
        window.requestAnimationFrame(() => openerRef.current?.focus());
        return;
      }
      setNetworkLost(false);
      setError(adjustmentErrorMessage(response.status, data.error));
      // Serveur joignable et refus définitif : la prochaine tentative est une nouvelle opération.
      if (response.status < 500 && response.status !== 429) newOperation();
      if (data.error === "BALANCE_CHANGED" && typeof data.balance === "number") {
        setCurrentBalance(data.balance);
        setPlanned(null);
        setStep("edit");
        router.refresh();
      }
    } catch {
      setNetworkLost(true);
      setError(ADJUSTMENT_NETWORK_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="actions" style={{ marginTop: 12 }}>
      <button ref={openerRef} type="button" className="btn" onClick={openDialog}>Ajuster manuellement le solde</button>
    </div>
    {success && <p className="notice success" role="status" style={{ marginBottom: 0 }}>{success}</p>}

    <dialog ref={dialogRef} className="adjust-dialog" aria-labelledby={step === "edit" ? "adjust-title" : "adjust-confirm-title"}
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}>
      {step === "edit" ? <form onSubmit={review} noValidate>
        <h3 id="adjust-title" style={{ marginTop: 0 }}>Ajuster manuellement le solde</h3>
        <p className="muted">Pour régulariser une opération qui n’a pas été enregistrée. Pour corriger une opération existante, annule-la depuis l’historique des transactions.</p>
        <div className="field">
          <label htmlFor="adjust-variation">Variation</label>
          <input ref={variationRef} id="adjust-variation" className="input" inputMode="text" autoComplete="off" placeholder="+2 ou -1"
            aria-describedby="adjust-variation-hint" value={variation}
            onChange={(event) => { setVariation(event.target.value); setError(""); }} />
          <small id="adjust-variation-hint" className="muted">Nombre entier : + pour ajouter, - pour retirer.</small>
        </div>
        <output className="adjust-preview" htmlFor="adjust-variation" aria-live="polite">
          <span><span>Solde actuel</span><strong>{formatUnits(currentBalance, units)}</strong></span>
          <span><span>Variation</span><strong>{preview.ok ? describeVariation(preview.variation, units) : "—"}</strong></span>
          <span><span>Nouveau solde</span><strong>{preview.ok ? formatUnits(preview.newBalance, units) : preview.error === "NEGATIVE" ? "Négatif : impossible" : "—"}</strong></span>
        </output>
        <div className="field">
          <label htmlFor="adjust-reason">Motif (obligatoire)</label>
          <textarea id="adjust-reason" className="input" rows={3} maxLength={ADJUST_REASON_MAX} value={reason}
            onChange={(event) => { setReason(event.target.value); setError(""); }} />
          <small className="muted">{reason.length}/{ADJUST_REASON_MAX} · visible dans le journal d’activité.</small>
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="actions">
          <button className="btn btn-primary" type="submit">Vérifier l’ajustement</button>
          <button className="btn" type="button" onClick={closeDialog}>Annuler</button>
        </div>
      </form> : planned && <div>
        <h3 id="adjust-confirm-title" ref={confirmTitleRef} tabIndex={-1} style={{ marginTop: 0 }}>Confirmer l’ajustement ?</h3>
        <dl className="adjust-summary">
          <div><dt>Client</dt><dd>{customerName}</dd></div>
          <div><dt>Ancien solde</dt><dd>{formatUnits(planned.oldBalance, units)}</dd></div>
          <div><dt>Variation</dt><dd>{describeVariation(planned.variation, units)}</dd></div>
          <div><dt>Nouveau solde</dt><dd>{formatUnits(planned.newBalance, units)}</dd></div>
          <div><dt>Motif</dt><dd>{planned.reason}</dd></div>
        </dl>
        {error && <p className={networkLost ? "notice" : "notice error"} role="alert">{error}</p>}
        <div className="actions">
          <button className="btn btn-primary" type="button" disabled={busy} aria-busy={busy} onClick={() => void submit()}>
            {busy ? "Enregistrement…" : networkLost ? "Réessayer" : "Confirmer l’ajustement"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => { setStep("edit"); setError(""); }}>Modifier</button>
          <button className="btn" type="button" disabled={busy} onClick={closeDialog}>Annuler</button>
        </div>
      </div>}
    </dialog>
  </>;
}

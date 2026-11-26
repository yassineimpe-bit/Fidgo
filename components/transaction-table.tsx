"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transactionTypeLabel } from "@/lib/transaction-history";

type Row={id:string;type:string;delta:number;balance_after:number;unit:string;created_at:string;short_code:string;first_name?:string|null;staff_email?:string|null;reversed:boolean};

const REVERSE_ERRORS: Record<string, string> = {
  ALREADY_REVERSED: "Cette transaction a déjà été annulée.",
  NEGATIVE_BALANCE: "Annulation impossible : le solde du client deviendrait négatif.",
  UNIT_MISMATCH: "Annulation impossible : cette opération est en tampons/points alors que le programme utilise désormais l’autre unité.",
  TRANSACTION_NOT_FOUND: "Transaction introuvable pour ce commerce.",
  CANNOT_REVERSE_REVERSAL: "Une annulation ne peut pas être annulée.",
  FORBIDDEN: "Ce compte ne peut pas annuler de transaction.",
  UNAUTHORIZED: "Session expirée. Reconnecte-toi puis réessaie.",
};

export function TransactionTable({ initial, canReverse }:{ initial:Row[]; canReverse:boolean }){
  const router = useRouter();
  const [rows,setRows]=useState(initial);
  const [message,setMessage]=useState<{ text:string; error:boolean } | null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [refreshing, startRefresh] = useTransition();
  const inFlightRef = useRef(false);
  // Même clé pour relancer une annulation dont la réponse a été perdue.
  const keysRef = useRef<Record<string, string>>({});

  // Après router.refresh(), le serveur renvoie le ledger à jour (contre-écriture incluse).
  useEffect(() => setRows(initial), [initial]);

  async function reverse(row:Row){
    if (inFlightRef.current || refreshing) return;
    if(!confirm("Confirmer l’annulation ? Le solde du client sera mis à jour."))return;
    inFlightRef.current = true;
    setBusy(row.id);setMessage(null);
    const idempotencyKey = keysRef.current[row.id] ?? (keysRef.current[row.id] = crypto.randomUUID());
    try{
      const r=await fetch("/api/transactions/reverse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({transactionId:row.id,idempotencyKey})});
      const data=await r.json().catch(()=>({})) as { error?: string };
      if(!r.ok){
        delete keysRef.current[row.id];
        setMessage({ text: REVERSE_ERRORS[String(data.error)] || "Annulation impossible pour le moment. Réessaie.", error: true });
        if (data.error === "ALREADY_REVERSED") startRefresh(() => router.refresh());
        return;
      }
      delete keysRef.current[row.id];
      setRows(prev=>prev.map(x=>x.id===row.id?{...x,reversed:true}:x));
      setMessage({ text: "Transaction annulée.", error: false });
      startRefresh(() => router.refresh());
    }catch{
      setMessage({ text: "Connexion perdue : l’annulation n’a pas été confirmée. Réessaie, sans risque de double annulation.", error: true });
    }finally{
      inFlightRef.current = false;
      setBusy(null);
    }
  }

  if(rows.length===0){return <section className="card"><div className="empty-state"><strong>Aucun passage enregistré.</strong><p>Chaque crédit ou récompense scannée en caisse apparaîtra ici.</p><a className="btn btn-primary" href="/s">Ouvrir le scanner</a></div></section>;}
  return <section className="card" aria-busy={refreshing}><div className="table-wrap table-cards"><table role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader">Client</th><th role="columnheader">Type</th><th role="columnheader">Delta</th><th role="columnheader">Solde</th><th role="columnheader">Employé</th><th role="columnheader">Date</th>{canReverse&&<th role="columnheader"></th>}</tr></thead><tbody role="rowgroup">{rows.map(x=><tr role="row" key={x.id}><td role="cell" className="cell-title">{x.first_name||x.short_code}</td><td role="cell" data-label="Type">{transactionTypeLabel(x.type)}{x.reversed?" · annulée":""}</td><td role="cell" data-label="Delta">{x.delta>0?"+":""}{x.delta}</td><td role="cell" data-label="Solde">{x.balance_after}</td><td role="cell" data-label="Employé">{x.staff_email||"système"}</td><td role="cell" data-label="Date">{new Date(x.created_at).toLocaleString("fr-FR")}</td>{canReverse&&<td role="cell" className="cell-actions">{x.type!=="reversal"&&!x.reversed&&<button className="btn" disabled={busy!==null||refreshing} aria-busy={busy===x.id} onClick={()=>reverse(x)}>{busy===x.id?"Annulation…":"Annuler"}</button>}</td>}</tr>)}</tbody></table></div>{message&&<div className={message.error?"notice error":"notice success"} role={message.error?"alert":"status"} style={{marginTop:12}}>{message.text}</div>}</section>;}

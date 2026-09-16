"use client";

import { useState } from "react";

type Customer = {
  id: string;
  first_name?: string | null;
  email?: string | null;
  phone?: string | null;
  marketing_consent: boolean;
  created_at: string;
  short_code?: string | null;
  balance?: number | null;
  active?: boolean | null;
};

export function CustomerTable({ initial, canManage, searchActive = false }: { initial: Customer[]; canManage: boolean; searchActive?: boolean }) {
  const [rows, setRows] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function adjust(customer: Customer) {
    const balanceInput = window.prompt("Nouveau solde", String(customer.balance ?? 0));
    if (balanceInput === null) return;
    const newBalance = Number(balanceInput);
    if (!Number.isInteger(newBalance) || newBalance < 0) {
      setMessage("Le nouveau solde doit être un nombre entier positif ou nul.");
      return;
    }
    const reason = window.prompt("Motif obligatoire de l’ajustement");
    if (!reason?.trim()) {
      setMessage("Un motif est obligatoire pour ajuster le solde.");
      return;
    }

    setBusy(customer.id);
    setMessage("");
    const response = await fetch(`/api/customers/${customer.id}/adjust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newBalance, reason: reason.trim(), idempotencyKey: crypto.randomUUID() }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      setMessage(data.error === "NO_CHANGE" ? "Le solde est déjà à cette valeur." : "Impossible d’ajuster le solde.");
      return;
    }
    setRows((current) => current.map((row) => row.id === customer.id ? { ...row, balance: Number(data.balance) } : row));
    setMessage(`Solde ajusté à ${data.balance}. Le motif et l’opération ont été enregistrés.`);
  }

  async function erase(customer: Customer) {
    if (!confirm("Effacer les données personnelles de ce client et désactiver sa carte ?")) return;
    setBusy(customer.id);
    const response = await fetch(`/api/customers/${customer.id}`, { method: "DELETE" });
    const data = await response.json();
    setBusy(null);
    if (!response.ok) {
      setMessage(data.error || "Erreur");
      return;
    }
    setRows((current) => current.filter((row) => row.id !== customer.id));
    setMessage("Données personnelles effacées et carte désactivée.");
  }

  if (rows.length === 0) {
    return <section className="card">
      <div className="empty-state">
        {searchActive ? <>
          <strong>Aucun résultat pour cette recherche.</strong>
          <p>Essaie un autre nom, email ou code court.</p>
        </> : <>
          <strong>Aucun client pour l’instant.</strong>
          <p>Imprime ton QR pour inscrire le premier client depuis ta caisse ou ta vitrine.</p>
          <a className="btn btn-primary" href="/dashboard/poster">Voir mon affiche QR</a>
        </>}
      </div>
    </section>;
  }

  return <section className="card">
    <div className="table-wrap"><table>
      <thead><tr><th>Client</th><th>Contact</th><th>Carte</th><th>Solde</th><th>Marketing</th>{canManage && <th>Actions</th>}</tr></thead>
      <tbody>{rows.map((customer) => <tr key={customer.id}>
        <td>{customer.first_name || "Sans prénom"}</td>
        <td>{customer.email || customer.phone || "Non fourni"}</td>
        <td>{customer.short_code || "—"}</td>
        <td>{customer.balance ?? 0}</td>
        <td>{customer.marketing_consent ? "Oui" : "Non"}</td>
        {canManage && <td><div className="actions" style={{margin:0}}>
          <button className="btn" disabled={busy === customer.id || !customer.active} onClick={() => adjust(customer)}>Ajuster</button>
          <a className="btn" href={`/api/customers/${customer.id}/export`}>Exporter</a>
          <button className="btn btn-danger" disabled={busy === customer.id} onClick={() => erase(customer)}>Effacer</button>
        </div></td>}
      </tr>)}</tbody>
    </table></div>
    {message && <div className="notice" style={{marginTop:12}}>{message}</div>}
  </section>;
}

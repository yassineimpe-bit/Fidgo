"use client";

import { FormEvent, useState } from "react";

type Employee = { id: string; email: string; role: string; active: boolean; created_at: string };

export function EmployeeManager({ initial }: { initial: Employee[] }) {
  const [rows, setRows] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/employees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password"), role: form.get("role") }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error || "Erreur"); return; }
    setRows((previous) => [...previous, data]);
    event.currentTarget.reset();
    setMessage("Employé créé.");
  }

  async function toggle(employee: Employee) {
    setMessage("");
    const response = await fetch(`/api/employees/${employee.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !employee.active }),
    });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error || "Erreur"); return; }
    setRows((previous) => previous.map((row) => row.id === employee.id ? data : row));
  }

  return <div className="grid grid-2">
    <section className="card">
      <h3>Ajouter un accès caisse</h3>
      <p className="muted">Crée uniquement les accès nécessaires. Un employé peut scanner et créditer, pas modifier le programme.</p>
      <form className="form" onSubmit={createEmployee}>
        <div className="field"><label>Email</label><input className="input" name="email" type="email" required autoComplete="off"/></div>
        <div className="field"><label>Mot de passe temporaire</label><input className="input" name="password" type="password" minLength={8} required autoComplete="new-password"/></div>
        <div className="field"><label>Rôle</label><select className="select" name="role"><option value="EMPLOYEE">Employé scanner</option><option value="VIEWER">Lecture seule</option></select></div>
        {message && <div className="notice">{message}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Création…" : "Créer l’accès"}</button>
      </form>
    </section>
    <section className="card">
      <h3>Équipe</h3>
      <div className="table-wrap"><table><thead><tr><th>Email</th><th>Rôle</th><th>État</th><th></th></tr></thead><tbody>
        {rows.map((employee) => <tr key={employee.id}><td>{employee.email}</td><td>{employee.role}</td><td>{employee.active ? "Actif" : "Coupé"}</td><td>{!['OWNER','MANAGER'].includes(employee.role) && <button className="btn" onClick={() => toggle(employee)}>{employee.active ? "Désactiver" : "Réactiver"}</button>}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}

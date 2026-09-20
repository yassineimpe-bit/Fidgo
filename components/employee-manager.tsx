"use client";

import { FormEvent, useState } from "react";
import {
  canAssignStaffRole,
  canManageStaffTarget,
  staffRoleLabel,
  type StaffRole,
} from "@/lib/loyalty";

type Employee = { id: string; email: string; role: StaffRole; active: boolean; created_at: string };

export function EmployeeManager({ initial, currentRole }: { initial: Employee[]; currentRole: StaffRole }) {
  const [rows, setRows] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), role: form.get("role") }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "Erreur"); return; }
      setRows((previous) => [...previous, data]);
      formElement.reset();
      setMessage("Accès créé.");
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }

  async function patchEmployee(employee: Employee, patch: { active?: boolean; role?: StaffRole }) {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "Erreur"); return; }
      setRows((previous) => previous.map((row) => row.id === employee.id ? data : row));
      setMessage("Accès mis à jour.");
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }

  const createRoles: StaffRole[] = ["MANAGER", "EMPLOYEE", "VIEWER"].filter((role) =>
    canAssignStaffRole(currentRole, role as StaffRole),
  ) as StaffRole[];

  return <div className="grid grid-2">
    <section className="card">
      <h3>Ajouter un accès</h3>
      <p className="muted">Le propriétaire peut déléguer la gestion à un manager. Un manager peut créer des accès employé ou lecture seule, jamais un autre manager.</p>
      <form className="form" onSubmit={createEmployee}>
        <div className="field"><label htmlFor="employee-email">Email</label><input className="input" id="employee-email" name="email" type="email" required autoComplete="off"/></div>
        <div className="field"><label htmlFor="employee-password">Mot de passe temporaire</label><input className="input" id="employee-password" name="password" type="password" minLength={8} required autoComplete="new-password"/></div>
        <div className="field"><label htmlFor="employee-role">Rôle</label><select className="select" id="employee-role" name="role">
          {createRoles.map((role) => <option key={role} value={role}>{staffRoleLabel(role)}</option>)}
        </select></div>
        {message && <div className="notice">{message}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "Création…" : "Créer l’accès"}</button>
      </form>
    </section>

    <section className="card">
      <h3>Équipe</h3>
      {rows.every((row) => ["OWNER", "MANAGER"].includes(row.role)) && <div className="notice" style={{marginBottom:12}}>
        Aucun accès caisse créé. Ajoute un employé pour éviter de partager le compte propriétaire.
      </div>}
      <div className="table-wrap"><table><thead><tr><th>Email</th><th>Rôle</th><th>État</th><th>Actions</th></tr></thead><tbody>
        {rows.map((employee) => {
          const manageable = canManageStaffTarget(currentRole, employee.role);
          const roleOptions: StaffRole[] = ["MANAGER", "EMPLOYEE", "VIEWER"].filter((role) =>
            canAssignStaffRole(currentRole, role as StaffRole),
          ) as StaffRole[];
          return <tr key={employee.id}>
            <td>{employee.email}</td>
            <td>
              {manageable
                ? <select
                    className="select"
                    aria-label={`Rôle de ${employee.email}`}
                    value={employee.role}
                    disabled={busy}
                    onChange={(event) => patchEmployee(employee, { role: event.target.value as StaffRole })}
                  >
                    {roleOptions.map((role) => <option key={role} value={role}>{staffRoleLabel(role)}</option>)}
                  </select>
                : staffRoleLabel(employee.role)}
            </td>
            <td>{employee.active ? "Actif" : "Coupé"}</td>
            <td>{manageable && <button className="btn" disabled={busy} onClick={() => patchEmployee(employee, { active: !employee.active })}>{employee.active ? "Désactiver" : "Réactiver"}</button>}</td>
          </tr>;
        })}
      </tbody></table></div>
    </section>
  </div>;
}

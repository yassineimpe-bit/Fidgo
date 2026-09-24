"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const errors: Record<string, string> = {
  EMAIL_ALREADY_USED: "Cet email est déjà utilisé. Choisis une autre adresse.",
  INVALID_INPUT: "Vérifie l’email et le mot de passe (8 caractères minimum).",
  EMPLOYEE_REQUIRED: "Crée un accès employé ou choisis de continuer seul.",
  STEP_NOT_READY: "Une étape précédente reste à enregistrer. Recharge la page pour la reprendre.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
};

export function OnboardingActions({ step, employeeEmails = [] }: { step: 3 | 4; employeeEmails?: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [employees, setEmployees] = useState(employeeEmails);

  async function advance(action: "team-created" | "team-skip" | "finish") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(errors[result.error] || "Impossible de continuer. Réessaie."); return; }
      router.push(action === "finish" ? "/dashboard" : "/onboarding?step=4");
      router.refresh();
    } catch {
      setError("Connexion perdue. Ta progression est conservée ; réessaie.");
    } finally {
      setBusy(false);
    }
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/employees", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), role: "EMPLOYEE" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(errors[result.error] || "Impossible de créer cet accès. Réessaie."); return; }
      setEmployees((previous) => [...previous, result.email]);
      formElement.reset();
    } catch {
      setError("Connexion perdue. Recharge la page pour vérifier si l’accès a été créé avant de réessayer.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="form">
    {step === 3 && <>
      <p className="muted">Un compte séparé permet à ton employé de scanner les cartes, sans accéder à tes réglages. Tu peux aussi continuer seul et ajouter ton équipe plus tard.</p>
      {employees.length > 0 ? <div className="notice success" role="status">Accès employé prêt : {employees.join(", ")}</div> : <form className="form" onSubmit={createEmployee}>
        <div className="field"><label htmlFor="onboarding-employee-email">Email de l’employé</label><input className="input" id="onboarding-employee-email" name="email" type="email" required autoComplete="off" disabled={busy}/></div>
        <div className="field"><label htmlFor="onboarding-employee-password">Mot de passe temporaire</label><input className="input" id="onboarding-employee-password" name="password" type="password" minLength={8} maxLength={256} required autoComplete="new-password" disabled={busy}/></div>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Enregistrement…" : "Créer l’accès employé"}</button>
      </form>}
      <button className="btn" disabled={busy} onClick={() => advance(employees.length ? "team-created" : "team-skip")}>
        {employees.length ? "Continuer vers mon QR" : "Je travaille seul pour le moment"}
      </button>
    </>}
    {step === 4 && <button className="btn btn-primary" disabled={busy} onClick={() => advance("finish")}>{busy ? "Enregistrement…" : "Terminer et ouvrir mon dashboard"}</button>}
    {error && <div className="notice error" role="alert">{error}</div>}
  </div>;
}

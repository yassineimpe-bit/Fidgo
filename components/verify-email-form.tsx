"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_OR_EXPIRED_LINK: "Ce lien a expiré ou a déjà été utilisé.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie dans quelques minutes.",
  INVALID_ORIGIN: "Requête refusée. Recharge la page puis réessaie.",
  EMAIL_VERIFICATION_UNAVAILABLE: "La vérification d’e-mail est momentanément indisponible.",
};

export function VerifyEmailForm({ token }: { token: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_MESSAGES[data.error] || "Impossible de valider cette adresse e-mail.");
        return;
      }
      router.replace("/login?verified=1");
      router.refresh();
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <p className="muted">Confirme que cette adresse e-mail t’appartient pour activer la connexion à ton espace commerçant.</p>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>
        {loading ? "Validation…" : "Valider mon adresse e-mail"}
      </button>
    </form>
  );
}

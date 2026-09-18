"use client";

import { useRef, useState } from "react";
import type { BillingPlan } from "@/lib/billing";

const ERROR_MESSAGES: Record<string, string> = {
  BILLING_DISABLED: "La facturation n’est pas activée sur cet environnement.",
  BILLING_NOT_CONFIGURED: "La configuration Stripe est incomplète.",
  ALREADY_SUBSCRIBED: "Un abonnement est déjà rattaché à ce commerce.",
  CHECKOUT_PENDING: "Une ouverture de paiement est déjà en cours. Réessaie dans quelques instants.",
  STRIPE_UNAVAILABLE: "Stripe est temporairement indisponible. Le reste de Retiko continue de fonctionner.",
  TOO_MANY_ATTEMPTS: "Trop de tentatives. Réessaie un peu plus tard.",
};

export function StartCheckoutButton({ plan, label }: { plan: BillingPlan; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef<string | null>(null);

  async function start() {
    setBusy(true);
    setError("");
    idempotencyKey.current ||= globalThis.crypto.randomUUID();
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
        },
        body: JSON.stringify({ plan }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        setError(ERROR_MESSAGES[data.error] || "Impossible d’ouvrir le paiement pour le moment.");
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <button type="button" className="btn btn-primary" disabled={busy} onClick={start}>
      {busy ? "Ouverture…" : label}
    </button>
    {error && <p className="notice error" role="alert" style={{marginTop:10}}>{error}</p>}
  </div>;
}
export function OpenBillingPortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openPortal() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        setError(ERROR_MESSAGES[data.error] || "Impossible d’ouvrir le portail pour le moment.");
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("Connexion impossible. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <button type="button" className="btn" disabled={busy} onClick={openPortal}>
      {busy ? "Ouverture…" : "Gérer mon abonnement"}
    </button>
    {error && <p className="notice error" role="alert" style={{marginTop:10}}>{error}</p>}
  </div>;
}

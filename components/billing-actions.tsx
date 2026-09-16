"use client";
import { useState } from "react";

export function StartCheckoutButton({ billingInterval, label }: { billingInterval: "monthly" | "annual"; label: string }) {
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ billingInterval }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) { window.location.href = data.url; return; }
    setBusy(false);
  }
  return <button className="btn btn-primary" disabled={busy} onClick={start}>{busy ? "…" : label}</button>;
}

export function OpenBillingPortalButton() {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) { window.location.href = data.url; return; }
    setBusy(false);
  }
  return <button className="btn" disabled={busy} onClick={open}>{busy ? "…" : "Gérer mon abonnement"}</button>;
}

"use client";

import { useEffect } from "react";
import { reportClientError } from "@/components/client-observability";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, error.digest);
  }, [error]);

  return (
    <main className="auth-wrap">
      <section className="card auth-card">
        <span className="eyebrow">Fidgo</span>
        <h2 style={{ margin: "14px 0 8px" }}>Service momentanément indisponible</h2>
        <p className="muted">
          La page n’a pas pu charger ses données. Aucune action fidélité n’a été validée pendant cet échec.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
          <button className="btn btn-primary" onClick={() => reset()}>
            Réessayer
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Recharger la page
          </button>
        </div>
        {error.digest ? (
          <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
            Référence incident : <code>{error.digest}</code>
          </p>
        ) : null}
      </section>
    </main>
  );
}

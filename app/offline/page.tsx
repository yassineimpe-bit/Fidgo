export default function OfflinePage() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#020203", color: "white" }}>
      <section style={{ width: "min(460px, 100%)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 24, padding: 24, background: "#121214" }}>
        <div style={{ fontSize: 13, fontWeight: 800, opacity: .65, textTransform: "uppercase", letterSpacing: ".08em" }}>Retiko · hors ligne</div>
        <h1 style={{ fontSize: 34, lineHeight: 1.05, margin: "18px 0 12px" }}>Connexion indisponible</h1>
        <p style={{ color: "#c8c8cd", lineHeight: 1.6 }}>
          Retiko ne crédite, ne débite et ne met aucune opération en attente sans connexion. Cette protection évite les doubles opérations et les écarts de solde.
        </p>
        <p style={{ color: "#c8c8cd", lineHeight: 1.6 }}>
          Dès que le réseau revient, retourne au scanner et reprends normalement. Les retries côté scanner restent idempotents.
        </p>
        <a href="/s" style={{ display: "inline-flex", minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 8, padding: "0 18px", borderRadius: 14, background: "white", color: "black", fontWeight: 900 }}>
          Revenir au scanner
        </a>
      </section>
    </main>
  );
}

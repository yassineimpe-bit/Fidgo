import Link from "next/link";

export function LegalPage({
  title,
  version,
  children,
}: {
  title: string;
  version?: string;
  children: React.ReactNode;
}) {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 20px 80px" }}>
      <Link href="/" className="muted">← Retiko</Link>
      <article className="card" style={{ marginTop: 20, padding: 28, lineHeight: 1.65 }}>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        {version && <p className="muted">Version {version}</p>}
        {children}
      </article>
    </main>
  );
}

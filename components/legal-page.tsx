import Link from "next/link";
import { LegalLinks } from "@/components/legal-links";

export function LegalPage({ title, version, children }: { title: string; version: string; children: React.ReactNode }) {
  return <main className="legal-page">
    <Link href="/" className="muted">← Retiko</Link>
    <article className="card">
      <h1>{title}</h1>
      <p className="muted">Version du {version}</p>
      <p className="legal-status">
        Document de travail décrivant le fonctionnement actuel du service. Il n’a pas encore été validé
        juridiquement et certaines informations sur l’éditeur restent à compléter avant toute facturation.
      </p>
      {children}
    </article>
    <div style={{ marginTop: 24 }}><LegalLinks /></div>
  </main>;
}

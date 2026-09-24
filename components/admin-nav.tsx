import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Vue d’ensemble" },
  { href: "/admin/establishments", label: "Commerces" },
  { href: "/admin/users", label: "Utilisateurs" },
  { href: "/admin/subscriptions", label: "Abonnements" },
  { href: "/admin/audit", label: "Journal admin" },
];

export function AdminNav({ email }: { email: string }) {
  return <header className="app-sidebar admin-sidebar no-print">
    <div className="app-sidebar-inner">
      <div className="app-sidebar-head">
        <Link className="brand" href="/admin">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-copy">Retiko · Super-admin</span>
        </Link>
      </div>
      <nav className="admin-sidebar-links" aria-label="Navigation super-admin">
        {LINKS.map((link) => <Link key={link.href} href={link.href} className="badge">{link.label}</Link>)}
      </nav>
      <div className="admin-meta">
        <p className="muted" style={{fontSize:13,overflowWrap:"anywhere"}}>Connecté en super-admin : {email}</p>
        <p className="muted" style={{fontSize:12}}>Chaque consultation et action est journalisée.</p>
      </div>
      <div className="app-sidebar-footer">
        <Link className="btn" href="/dashboard">Mon commerce</Link>
      </div>
    </div>
  </header>;
}

export function StatusBadge({ status, platform }: { status: string; platform: boolean }) {
  if (status === "active") return <span className="badge success">Actif</span>;
  return <span className="badge warning">{platform ? "Suspendu par Retiko" : "Fermé par le commerçant"}</span>;
}

export function Pager({ page, totalPages, href }: { page: number; totalPages: number; href: (page: number) => string }) {
  if (totalPages <= 1) return null;
  return <nav className="actions" aria-label="Pagination" style={{justifyContent:"space-between"}}>
    <div>{page > 1 && <Link className="btn" href={href(page - 1)}>← Précédent</Link>}</div>
    <span className="muted">Page {page} sur {totalPages}</span>
    <div>{page < totalPages && <Link className="btn" href={href(page + 1)}>Suivant →</Link>}</div>
  </nav>;
}

export function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
}

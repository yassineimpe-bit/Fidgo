import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Vue d’ensemble" },
  { href: "/admin/establishments", label: "Commerces" },
  { href: "/admin/users", label: "Utilisateurs" },
  { href: "/admin/subscriptions", label: "Abonnements" },
  { href: "/admin/audit", label: "Journal admin" },
];

// .navlinks ne rétrécit pas (flex-shrink:0) : cinq liens y débordent sur mobile.
export function AdminNav({ email }: { email: string }) {
  return <header className="topbar no-print" style={{position:"static"}}>
    <div className="shell topbar-inner">
      <Link className="brand" href="/admin">Retiko · Super-admin</Link>
      <Link className="btn" href="/dashboard" style={{flexShrink:0}}>Mon commerce</Link>
    </div>
    <nav className="shell" aria-label="Navigation super-admin" style={{display:"flex",flexWrap:"wrap",gap:8,paddingBottom:10}}>
      {LINKS.map((link) => <Link key={link.href} href={link.href} className="badge">{link.label}</Link>)}
    </nav>
    <div className="shell"><p className="muted" style={{margin:"0 0 10px",fontSize:13,overflowWrap:"anywhere"}}>Connecté en super-admin : {email} · chaque consultation et action est journalisée.</p></div>
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

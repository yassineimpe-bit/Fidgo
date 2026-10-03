import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

/**
 * Affichée par /admin sans session super-admin (absente, expirée, ou session
 * commerçant ordinaire) : aucune donnée admin n'est rendue. La restriction à
 * platform_admins est appliquée par /api/auth/login (scope admin).
 */
export function AdminLogin() {
  return <main className="auth-wrap">
    <section className="card auth-card">
      <span className="eyebrow">Retiko · Super-admin</span>
      <h2 style={{ marginTop: 16 }}>Connexion administrateur</h2>
      <AuthForm mode="admin" />
      <p className="muted" style={{ marginTop: 18 }}><Link href="/">Retour à retiko.fr</Link></p>
    </section>
  </main>;
}

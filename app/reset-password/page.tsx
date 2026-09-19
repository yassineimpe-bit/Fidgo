import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { isValidPasswordResetToken } from "@/lib/password-reset";

export const metadata: Metadata = {
  title: "Réinitialiser mon mot de passe | Retiko",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const validShape = typeof token === "string" && isValidPasswordResetToken(token);

  return <main className="auth-wrap"><section className="card auth-card">
    <span className="eyebrow">Retiko</span>
    <h2 style={{margin:"14px 0 8px"}}>Réinitialiser mon mot de passe</h2>
    {validShape ? <ResetPasswordForm token={token!}/> : <>
      <div className="notice error">Ce lien de réinitialisation est invalide.</div>
      <p className="muted">Retourne sur la page de connexion et demande un nouveau lien.</p>
    </>}
    <p className="muted" style={{marginTop:18}}><Link href="/login"><strong>Retour à la connexion</strong></Link></p>
  </section></main>;
}

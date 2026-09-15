import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { isValidStaffResetToken } from "@/lib/staff-password-reset";

export const metadata: Metadata = {
  title: "Réinitialiser mon mot de passe | Fidgo",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const validShape = isValidStaffResetToken(token);

  return <main className="auth-wrap">
    <section className="card auth-card">
      <span className="eyebrow">Fidgo</span>
      <h2 style={{margin:"14px 0 8px"}}>Choisir un nouveau mot de passe</h2>
      {validShape ? <ResetPasswordForm token={token}/> : <>
        <div className="notice error">Ce lien de réinitialisation est invalide.</div>
        <p className="muted">Redemande un nouveau lien depuis la page mot de passe oublié.</p>
      </>}
      <div style={{marginTop:18}}><Link className="btn" href="/login">Retour à la connexion</Link></div>
    </section>
  </main>;
}

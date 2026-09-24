import type { Metadata } from "next";
import Link from "next/link";
import { VerifyEmailForm } from "@/components/verify-email-form";
import { isValidEmailVerificationToken } from "@/lib/email-verification";

export const metadata: Metadata = {
  title: "Vérifier mon e-mail | Retiko",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const validShape = typeof token === "string" && isValidEmailVerificationToken(token);

  return <main className="auth-wrap"><section className="card auth-card">
    <span className="eyebrow">Retiko</span>
    <h2 style={{margin:"14px 0 8px"}}>Vérifier mon adresse e-mail</h2>
    {validShape ? <VerifyEmailForm token={token!}/> : <>
      <div className="notice error">Ce lien de vérification est invalide.</div>
      <p className="muted">Demande un nouveau lien de vérification puis réessaie.</p>
    </>}
    <p className="muted" style={{marginTop:18}}>
      <Link href="/verify-email/resend"><strong>Renvoyer un lien</strong></Link>
      {" · "}
      <Link href="/login">Retour à la connexion</Link>
    </p>
  </section></main>;
}

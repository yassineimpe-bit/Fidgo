import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = {
  title: "Mot de passe oublié | Fidgo",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default function ForgotPasswordPage() {
  return <main className="auth-wrap"><section className="card auth-card">
    <span className="eyebrow">Espace commerçant</span>
    <h2 style={{marginTop:16}}>Mot de passe oublié</h2>
    <p className="muted" style={{marginTop:8}}>Indique l’adresse email de ton compte, on t’envoie un lien pour choisir un nouveau mot de passe.</p>
    <ForgotPasswordForm/>
    <p className="muted" style={{marginTop:18}}><Link href="/login">Retour à la connexion</Link></p>
  </section></main>;
}

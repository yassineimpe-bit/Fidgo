import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return <main className="auth-wrap"><section className="card auth-card">
    <span className="eyebrow">Espace commerçant</span>
    <h2 style={{marginTop:16}}>Mot de passe oublié</h2>
    <p className="muted" style={{marginBottom:18}}>Indique ton email de connexion pour recevoir un lien de réinitialisation.</p>
    <ForgotPasswordForm/>
    <p className="muted" style={{marginTop:18}}><Link href="/login"><strong>Retour à la connexion</strong></Link></p>
  </section></main>;
}

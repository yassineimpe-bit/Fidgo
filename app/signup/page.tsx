import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  return <main className="auth-wrap"><section className="card auth-card"><span className="eyebrow">Pilote SaaS</span><h2 style={{marginTop:16}}>Créer mon commerce</h2><p className="muted">Un établissement, un compte owner et un programme de fidélité par défaut. Ton e-mail devra être vérifié avant la première connexion.</p><AuthForm mode="signup"/><p className="muted" style={{marginTop:18}}>Déjà inscrit ? <Link href="/login"><strong>Connexion</strong></Link></p></section></main>;
}

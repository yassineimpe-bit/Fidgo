import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
export default function LoginPage() {
  return <main className="auth-wrap"><section className="card auth-card"><span className="eyebrow">Espace commerçant</span><h2 style={{marginTop:16}}>Connexion</h2><AuthForm mode="login"/><p className="muted" style={{marginTop:14}}><Link href="/forgot-password">Mot de passe oublié ?</Link></p><p className="muted" style={{marginTop:4}}>Pas encore de compte ? <Link href="/signup"><strong>Créer un restaurant</strong></Link></p></section></main>;
}

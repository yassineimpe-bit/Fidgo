import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  const { verified } = await searchParams;
  return <main className="auth-wrap"><section className="card auth-card">
    <span className="eyebrow">Espace commerçant</span>
    <h2 style={{marginTop:16}}>Connexion</h2>
    {verified === "1" && <div className="notice success" role="status">Adresse e-mail vérifiée. Tu peux maintenant te connecter.</div>}
    <AuthForm mode="login"/>
    <p className="muted" style={{marginTop:14}}><Link href="/forgot-password">Mot de passe oublié ?</Link></p>
    <p className="muted" style={{marginTop:4}}>Pas encore de compte ? <Link href="/signup"><strong>Créer mon commerce</strong></Link></p>
  </section></main>;
}

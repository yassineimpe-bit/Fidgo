import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";
import { ONBOARDING_STEPS, onboardingDisplayStep, onboardingPageStep } from "@/lib/onboarding";
import { RestaurantForm } from "@/components/restaurant-form";
import { ProgramForm, type Program } from "@/components/program-form";
import { BrandPreview } from "@/components/brand-preview";
import { cardImagePath } from "@/lib/card-image-path";
import { readCardImageOverlay } from "@/lib/card-design";
import { OnboardingActions } from "@/components/onboarding-actions";
import { PwaInstallHint } from "@/components/pwa-install-hint";
import { programUnits } from "@/lib/program-units";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER") redirect(session.role === "EMPLOYEE" ? "/s" : "/dashboard");
  const [restaurant] = await sql`select name,slug,logo_url,primary_color,to_jsonb(e)->>'secondary_color' as secondary_color,to_jsonb(e)->>'card_background' as card_background,to_jsonb(e)->>'card_image_id' as card_image_id,to_jsonb(e)->>'card_image_overlay' as card_image_overlay,address,phone,instagram,website,onboarding_step from establishments e where id=${session.establishmentId}`;
  if (!restaurant || restaurant.onboarding_step === null || Number(restaurant.onboarding_step) >= 5) redirect("/dashboard");
  const [row] = await sql`select * from loyalty_programs where establishment_id=${session.establishmentId} and active=true`;
  if (!row) redirect("/dashboard");
  const savedStep = Number(restaurant.onboarding_step);
  const reachedStep = onboardingDisplayStep(savedStep);
  const step = onboardingPageStep(savedStep, (await searchParams).step);
  const totalSteps = ONBOARDING_STEPS.length;
  const joinUrl = `${getAppUrl() || "http://localhost:3000"}/j/${restaurant.slug}`;
  const qr = await QRCode.toDataURL(joinUrl, { width: 320, margin: 1, errorCorrectionLevel: "M" });
  const brand = { name: String(restaurant.name), logoUrl: String(restaurant.logo_url || ""), primaryColor: String(restaurant.primary_color), secondaryColor: restaurant.secondary_color ? String(restaurant.secondary_color) : null, cardBackground: restaurant.card_background ? String(restaurant.card_background) : null, cardImageUrl: restaurant.card_image_id ? cardImagePath(String(restaurant.card_image_id)) : null, cardImageOverlay: readCardImageOverlay(restaurant.card_image_overlay), qr };
  const reward = { rewardThreshold: Number(row.reward_threshold), rewardLabel: String(row.reward_label), unit: programUnits(row.mode, row.unit_label, row.unit_label_plural).plural };

  return <main className="shell page onboarding-shell">
    <Link href="/" className="eyebrow">Retiko</Link>
    <h1>Prépare ton commerce</h1>
    <p className="muted">Ton compte est créé. Trois étapes jusqu’à ton QR d’inscription, puis un test guidé. Chaque étape enregistrée est conservée pour reprendre quand tu veux.</p>
    <nav className="onboarding-steps" aria-label="Étapes de configuration">
      <ol style={{display:"flex",flexWrap:"wrap",gap:16,listStyle:"none",padding:0}}>
        {ONBOARDING_STEPS.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
          {index + 1 <= reachedStep ? <Link href={`/onboarding?step=${index + 1}`} style={{fontWeight:step === index + 1 ? 800 : 400}}>{index + 1 < reachedStep ? "✓" : index + 1} · {label}</Link> : <span className="muted">{index + 1} · {label}</span>}
        </li>)}
      </ol>
    </nav>
    <h2>Étape {step} sur {totalSteps} · {ONBOARDING_STEPS[step - 1]}</h2>
    {step > 1 && <p><Link href={`/onboarding?step=${step - 1}`}>← Étape précédente : {ONBOARDING_STEPS[step - 2]}</Link></p>}
    {step === 1 && <>
      <p className="muted">Le nom et la couleur suffisent pour commencer. Logo, coordonnées et fond de carte sont facultatifs et modifiables à tout moment.</p>
      <RestaurantForm onboarding restaurant={{name:brand.name,logo_url:brand.logoUrl,primary_color:brand.primaryColor,secondary_color:brand.secondaryColor,card_background:brand.cardBackground,card_image_id:restaurant.card_image_id ? String(restaurant.card_image_id) : null,card_image_overlay:brand.cardImageOverlay,address:restaurant.address,phone:restaurant.phone,instagram:restaurant.instagram,website:restaurant.website}} preview={{...reward,qr}}/>
    </>}
    {step === 2 && <section className="card">
      <p className="muted">Choisis des tampons par passage ou des points par achat ou par euro. Définis l’objectif et ce que ton client recevra.</p>
      <ProgramForm onboarding program={row as unknown as Program} preview={brand}/>
    </section>}
    {step === 3 && <section className="card form">
      <h3>Ton QR d’inscription est prêt</h3>
      <p className="muted">Tes clients le scannent pour créer leur carte de fidélité. Imprime l’affiche et place-la au comptoir.</p>
      <BrandPreview {...brand} {...reward}/>
      <a href={joinUrl} target="_blank" rel="noopener noreferrer" style={{overflowWrap:"anywhere"}}>Ouvrir l’inscription client</a>
      <Link className="btn" href="/dashboard/poster" target="_blank" rel="noopener noreferrer">Ouvrir mon affiche à imprimer</Link>
      <PwaInstallHint/>
      <p className="muted">À l’étape suivante, un parcours guidé te fait créer une carte test et la scanner. Ton équipe pourra être ajoutée ensuite, depuis le dashboard.</p>
      <OnboardingActions/>
    </section>}
    <p style={{marginTop:24}}><Link href="/dashboard">Reprendre plus tard</Link></p>
  </main>;
}

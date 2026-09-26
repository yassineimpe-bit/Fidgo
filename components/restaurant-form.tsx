"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { isValidHexColor } from "@/lib/brand-color";
import { BrandPreview } from "@/components/brand-preview";
import { LogoUploader } from "@/components/logo-uploader";
import { CardImageUploader } from "@/components/card-image-uploader";
import { cardImagePath } from "@/lib/card-image-path";

type Restaurant = { name: string; logo_url?: string | null; primary_color: string; secondary_color?: string | null; card_background?: string | null; card_image_id?: string | null; address?: string | null; phone?: string | null; instagram?: string | null; website?: string | null };
type PreviewData = { rewardThreshold: number; rewardLabel: string; unit: string; qr: string };

export function RestaurantForm({ restaurant, preview, onboarding = false }: { restaurant: Restaurant; preview: PreviewData; onboarding?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // État "live" pour l'aperçu temps réel (item 5) : le reste du formulaire
  // (adresse, téléphone...) n'a pas besoin d'être contrôlé.
  const [name, setName] = useState(restaurant.name);
  const [logoUrl, setLogoUrl] = useState(restaurant.logo_url || "");
  const [primaryColor, setPrimaryColor] = useState(restaurant.primary_color || "#111111");
  const [hexInput, setHexInput] = useState(restaurant.primary_color || "#111111");
  const [secondaryColor, setSecondaryColor] = useState(restaurant.secondary_color || "");
  const [cardImageUrl, setCardImageUrl] = useState<string | null>(restaurant.card_image_id ? cardImagePath(restaurant.card_image_id) : null);
  const [cardBackground, setCardBackground] = useState(
    (restaurant.card_background === "gradient" && restaurant.secondary_color) || (restaurant.card_background === "image" && restaurant.card_image_id)
      ? String(restaurant.card_background)
      : "solid",
  );
  // Fond réellement applicable : dégradé sans secondaire ou image sans visuel retombent sur l'uni.
  const effectiveBackground = (cardBackground === "gradient" && !secondaryColor) || (cardBackground === "image" && !cardImageUrl) ? "solid" : cardBackground;

  function applyColor(value: string) {
    setPrimaryColor(value);
    setHexInput(value);
  }

  function applyHexInput(value: string) {
    setHexInput(value);
    if (isValidHexColor(value)) setPrimaryColor(value);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const f = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/restaurant", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ onboarding,name,logoUrl,primaryColor,secondaryColor:secondaryColor||null,cardBackground:effectiveBackground,address:f.get("address"),phone:f.get("phone"),instagram:f.get("instagram"),website:f.get("website") }) });
      const error = response.ok ? "" : String((await response.json().catch(() => ({}))).error || "");
      setMessage(response.ok ? "Commerce enregistré." : error === "CARD_DESIGN_UNAVAILABLE"
        ? "La couleur secondaire n’est pas encore disponible sur ce serveur."
        : "Impossible d’enregistrer. Vérifie les champs et les URL HTTPS.");
      if (response.ok && onboarding) { router.push("/onboarding?step=2"); router.refresh(); }
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="grid grid-2" style={{alignItems:"start"}}>
    <form className="card form" onSubmit={submit}>
      <div className="grid grid-2">
        <div className="field"><label htmlFor="restaurant-name">Nom</label><input className="input" id="restaurant-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required/></div>
        <div className="field">
          <label htmlFor="restaurant-color">Couleur principale</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input aria-label="Sélecteur de couleur" id="restaurant-color" type="color" value={primaryColor} onChange={(e) => applyColor(e.target.value)} style={{width:44,height:40,padding:2,flexShrink:0}}/>
            <input className="input" aria-label="Code hexadécimal de la couleur" value={hexInput} onChange={(e) => applyHexInput(e.target.value)} placeholder="#111111" maxLength={7} style={{fontFamily:"monospace"}}/>
          </div>
          {!isValidHexColor(hexInput) && <small style={{color:"var(--danger, #d33)"}}>Format attendu : #RRGGBB</small>}
        </div>
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="restaurant-secondary-color">Couleur secondaire</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input id="restaurant-secondary-color" aria-label="Couleur secondaire" type="color" value={secondaryColor || "#ffffff"} onChange={(e) => setSecondaryColor(e.target.value)} style={{width:44,height:40,padding:2,flexShrink:0}}/>
            {secondaryColor ? <button type="button" className="btn" onClick={() => setSecondaryColor("")}>Retirer</button> : <small className="muted">Facultative</small>}
          </div>
          <small className="muted">Barre de progression et fin du dégradé.</small>
        </div>
        <div className="field">
          <label htmlFor="restaurant-card-background">Fond de la carte</label>
          <select className="select" id="restaurant-card-background" value={effectiveBackground} disabled={!secondaryColor && !cardImageUrl} onChange={(e) => setCardBackground(e.target.value)}>
            <option value="solid">Couleur principale unie</option>
            <option value="gradient" disabled={!secondaryColor}>Dégradé principale → secondaire</option>
            <option value="image" disabled={!cardImageUrl}>Visuel importé</option>
          </select>
        </div>
      </div>
      {!onboarding && <CardImageUploader cardImageUrl={cardImageUrl} onChange={(url) => { setCardImageUrl(url); if (url) setCardBackground("image"); router.refresh(); }}/>}
      <LogoUploader logoUrl={logoUrl} onChange={setLogoUrl}/>
      <div className="field"><label htmlFor="restaurant-logo">URL du logo</label><input className="input" id="restaurant-logo" type="text" inputMode="url" maxLength={500} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png"/><small className="muted">Ou l’adresse HTTPS d’une image déjà en ligne. Un logo importé apparaît ici sous la forme /api/logos/….</small></div>
      <div className="field"><label htmlFor="restaurant-address">Adresse</label><input className="input" id="restaurant-address" name="address" maxLength={240} defaultValue={restaurant.address || ""}/></div>
      <div className="grid grid-2"><div className="field"><label htmlFor="restaurant-phone">Téléphone</label><input className="input" id="restaurant-phone" name="phone" maxLength={40} defaultValue={restaurant.phone || ""}/></div><div className="field"><label htmlFor="restaurant-instagram">Instagram</label><input className="input" id="restaurant-instagram" name="instagram" maxLength={120} defaultValue={restaurant.instagram || ""}/></div></div>
      <div className="field"><label htmlFor="restaurant-website">Site web</label><input className="input" id="restaurant-website" name="website" type="url" maxLength={500} defaultValue={restaurant.website || ""}/></div>
      {message && <div className="notice" role={message.includes("enregistré") ? undefined : "alert"}>{message}</div>}<button className="btn btn-primary" disabled={busy || !isValidHexColor(hexInput)}>{busy ? "Enregistrement…" : onboarding ? "Enregistrer et continuer" : "Enregistrer"}</button>
    </form>
    <div className="card" style={{background:"var(--surface-2, #f5f6f8)"}}>
      <h3 style={{marginTop:0}}>Aperçu</h3>
      <p className="muted" style={{marginTop:-8}}>Ce que verra ton client sur sa carte et l’affiche.</p>
      <BrandPreview name={name} logoUrl={logoUrl} primaryColor={isValidHexColor(hexInput) ? primaryColor : "#111111"} secondaryColor={secondaryColor || null} cardBackground={effectiveBackground} cardImageUrl={cardImageUrl} rewardThreshold={preview.rewardThreshold} rewardLabel={preview.rewardLabel} unit={preview.unit} qr={preview.qr}/>
    </div>
  </div>;
}

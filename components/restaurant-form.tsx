"use client";
import { FormEvent, useState } from "react";
import { isValidHexColor } from "@/lib/brand-color";
import { BrandPreview } from "@/components/brand-preview";

type Restaurant = { name: string; logo_url?: string | null; primary_color: string; address?: string | null; phone?: string | null; instagram?: string | null; website?: string | null };
type PreviewData = { rewardThreshold: number; rewardLabel: string; unit: string; qr: string };

export function RestaurantForm({ restaurant, preview }: { restaurant: Restaurant; preview: PreviewData }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // État "live" pour l'aperçu temps réel (item 5) : le reste du formulaire
  // (adresse, téléphone...) n'a pas besoin d'être contrôlé.
  const [name, setName] = useState(restaurant.name);
  const [logoUrl, setLogoUrl] = useState(restaurant.logo_url || "");
  const [primaryColor, setPrimaryColor] = useState(restaurant.primary_color || "#111111");
  const [hexInput, setHexInput] = useState(restaurant.primary_color || "#111111");

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
      const response = await fetch("/api/restaurant", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name,logoUrl,primaryColor,address:f.get("address"),phone:f.get("phone"),instagram:f.get("instagram"),website:f.get("website") }) });
      setMessage(response.ok ? "Commerce enregistré." : "Impossible d’enregistrer.");
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau puis réessaie.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="grid grid-2" style={{alignItems:"start"}}>
    <form className="card form" onSubmit={submit}>
      <div className="grid grid-2">
        <div className="field"><label htmlFor="restaurant-name">Nom</label><input className="input" id="restaurant-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}/></div>
        <div className="field">
          <label htmlFor="restaurant-color">Couleur principale</label>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input aria-label="Sélecteur de couleur" id="restaurant-color" type="color" value={primaryColor} onChange={(e) => applyColor(e.target.value)} style={{width:44,height:40,padding:2,flexShrink:0}}/>
            <input className="input" aria-label="Code hexadécimal de la couleur" value={hexInput} onChange={(e) => applyHexInput(e.target.value)} placeholder="#111111" maxLength={7} style={{fontFamily:"monospace"}}/>
          </div>
          {!isValidHexColor(hexInput) && <small style={{color:"var(--danger, #d33)"}}>Format attendu : #RRGGBB</small>}
        </div>
      </div>
      <div className="field"><label htmlFor="restaurant-logo">URL du logo</label><input className="input" id="restaurant-logo" type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png"/><small className="muted">PNG, JPEG ou WebP hébergé en HTTPS. Pas d’upload de fichier pour l’instant.</small></div>
      <div className="field"><label htmlFor="restaurant-address">Adresse</label><input className="input" id="restaurant-address" name="address" defaultValue={restaurant.address || ""}/></div>
      <div className="grid grid-2"><div className="field"><label htmlFor="restaurant-phone">Téléphone</label><input className="input" id="restaurant-phone" name="phone" defaultValue={restaurant.phone || ""}/></div><div className="field"><label htmlFor="restaurant-instagram">Instagram</label><input className="input" id="restaurant-instagram" name="instagram" defaultValue={restaurant.instagram || ""}/></div></div>
      <div className="field"><label htmlFor="restaurant-website">Site web</label><input className="input" id="restaurant-website" name="website" type="url" defaultValue={restaurant.website || ""}/></div>
      {message && <div className="notice" role={message.includes("enregistré") ? undefined : "alert"}>{message}</div>}<button className="btn btn-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
    </form>
    <div className="card" style={{background:"var(--surface-2, #f5f6f8)"}}>
      <h3 style={{marginTop:0}}>Aperçu</h3>
      <p className="muted" style={{marginTop:-8}}>Ce que verra ton client sur sa carte et l’affiche.</p>
      <BrandPreview name={name} logoUrl={logoUrl} primaryColor={isValidHexColor(hexInput) ? primaryColor : "#111111"} rewardThreshold={preview.rewardThreshold} rewardLabel={preview.rewardLabel} unit={preview.unit} qr={preview.qr}/>
    </div>
  </div>;
}

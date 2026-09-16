"use client";
import { FormEvent, useState } from "react";

type Restaurant = { name: string; logo_url?: string | null; primary_color: string; address?: string | null; phone?: string | null; instagram?: string | null; website?: string | null };
export function RestaurantForm({ restaurant }: { restaurant: Restaurant }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const f = new FormData(event.currentTarget);
    const response = await fetch("/api/restaurant", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name:f.get("name"),logoUrl:f.get("logoUrl"),primaryColor:f.get("primaryColor"),address:f.get("address"),phone:f.get("phone"),instagram:f.get("instagram"),website:f.get("website") }) });
    setBusy(false); setMessage(response.ok ? "Commerce enregistré." : "Impossible d’enregistrer.");
  }
  return <form className="card form" onSubmit={submit}>
    <div className="grid grid-2"><div className="field"><label htmlFor="restaurant-name">Nom</label><input className="input" id="restaurant-name" name="name" defaultValue={restaurant.name}/></div><div className="field"><label htmlFor="restaurant-color">Couleur</label><input className="input" id="restaurant-color" name="primaryColor" type="color" defaultValue={restaurant.primary_color || "#111111"}/></div></div>
    <div className="field"><label htmlFor="restaurant-logo">URL du logo</label><input className="input" id="restaurant-logo" name="logoUrl" type="url" defaultValue={restaurant.logo_url || ""}/></div>
    <div className="field"><label htmlFor="restaurant-address">Adresse</label><input className="input" id="restaurant-address" name="address" defaultValue={restaurant.address || ""}/></div>
    <div className="grid grid-2"><div className="field"><label htmlFor="restaurant-phone">Téléphone</label><input className="input" id="restaurant-phone" name="phone" defaultValue={restaurant.phone || ""}/></div><div className="field"><label htmlFor="restaurant-instagram">Instagram</label><input className="input" id="restaurant-instagram" name="instagram" defaultValue={restaurant.instagram || ""}/></div></div>
    <div className="field"><label htmlFor="restaurant-website">Site web</label><input className="input" id="restaurant-website" name="website" type="url" defaultValue={restaurant.website || ""}/></div>
    {message && <div className="notice">{message}</div>}<button className="btn btn-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button>
  </form>;
}

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAppUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageEstablishment } from "@/lib/loyalty";
import { AppNav } from "@/components/app-nav";
import { RestaurantForm } from "@/components/restaurant-form";

export default async function SettingsPage(){
  const session=await getSession(); if(!session) redirect("/login"); if(!canManageEstablishment(session.role)) redirect("/dashboard");
  const [restaurant]=await sql`
    select e.name,e.slug,e.logo_url,e.primary_color,e.address,e.phone,e.instagram,e.website,
      p.mode,p.reward_threshold,p.reward_label
    from establishments e
    join loyalty_programs p on p.establishment_id=e.id
    where e.id=${session.establishmentId} and p.active=true
  `;
  const base = getAppUrl() || "http://localhost:3000";
  const qr = await QRCode.toDataURL(`${base}/j/${restaurant.slug}`, { width: 240, margin: 1, errorCorrectionLevel: "M" });
  return <><AppNav restaurantName={restaurant.name}/><main className="shell page"><div className="section-head"><div><h2>Commerce</h2><p className="muted">Identité affichée sur la carte fidélité et les supports d’inscription.</p></div></div><RestaurantForm
    restaurant={restaurant as { name:string; logo_url?:string|null; primary_color:string; address?:string|null; phone?:string|null; instagram?:string|null; website?:string|null }}
    preview={{ rewardThreshold: Number(restaurant.reward_threshold), rewardLabel: String(restaurant.reward_label), unit: restaurant.mode === "STAMPS" ? "tampons" : "points", qr }}
  /></main></>;
}

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAppUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageEstablishment } from "@/lib/loyalty";
import { AppNav } from "@/components/app-nav";
import { RestaurantForm } from "@/components/restaurant-form";
import { programUnits } from "@/lib/program-units";

export default async function SettingsPage(){
  const session=await getSession(); if(!session) redirect("/login"); if(!canManageEstablishment(session.role)) redirect("/dashboard");
  const [restaurant]=await sql`
    select e.name,e.slug,e.logo_url,e.primary_color,to_jsonb(e)->>'secondary_color' as secondary_color,to_jsonb(e)->>'card_background' as card_background,to_jsonb(e)->>'card_image_id' as card_image_id,e.address,e.phone,e.instagram,e.website,
      p.mode,p.reward_threshold,p.reward_label,to_jsonb(p)->>'unit_label' as unit_label, to_jsonb(p)->>'unit_label_plural' as unit_label_plural
    from establishments e
    join loyalty_programs p on p.establishment_id=e.id
    where e.id=${session.establishmentId} and p.active=true
  `;
  const base = getAppUrl() || "http://localhost:3000";
  const qr = await QRCode.toDataURL(`${base}/j/${restaurant.slug}`, { width: 240, margin: 1, errorCorrectionLevel: "M" });
  return <><AppNav restaurantName={restaurant.name}/><main className="shell page"><div className="section-head"><div><h2>Commerce</h2><p className="muted">Identité affichée sur la carte fidélité et les supports d’inscription.</p></div></div><RestaurantForm
    restaurant={restaurant as { name:string; logo_url?:string|null; primary_color:string; secondary_color?:string|null; card_background?:string|null; card_image_id?:string|null; address?:string|null; phone?:string|null; instagram?:string|null; website?:string|null }}
    preview={{ rewardThreshold: Number(restaurant.reward_threshold), rewardLabel: String(restaurant.reward_label), unit: programUnits(restaurant.mode, restaurant.unit_label, restaurant.unit_label_plural).plural, qr }}
  /></main></>;
}

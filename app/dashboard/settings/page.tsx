import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { AppNav } from "@/components/app-nav";
import { RestaurantForm } from "@/components/restaurant-form";

export default async function SettingsPage(){
  const session=await getSession(); if(!session) redirect("/login"); if(!canManageProgram(session.role)) redirect("/dashboard");
  const [restaurant]=await sql`select name,logo_url,primary_color,address,phone,instagram,website from establishments where id=${session.establishmentId}`;
  return <><AppNav restaurantName={restaurant.name}/><main className="shell page"><div className="section-head"><div><h2>Commerce</h2><p className="muted">Identité affichée sur la carte fidélité et les supports d’inscription.</p></div></div><RestaurantForm restaurant={restaurant as { name:string; logo_url?:string|null; primary_color:string; address?:string|null; phone?:string|null; instagram?:string|null; website?:string|null }}/></main></>;
}

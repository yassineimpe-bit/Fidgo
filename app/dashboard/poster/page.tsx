import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getAppUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canManageProgram } from "@/lib/loyalty";
import { PosterView } from "@/components/poster-view";
import { programUnits } from "@/lib/program-units";

export default async function PosterPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canManageProgram(session.role)) redirect(session.role === "EMPLOYEE" ? "/s" : "/dashboard");

  const [restaurant] = await sql`
    select e.name, e.slug, e.logo_url, e.primary_color,
      p.mode, p.reward_threshold, p.reward_label, to_jsonb(p)->>'unit_label' as unit_label, to_jsonb(p)->>'unit_label_plural' as unit_label_plural
    from establishments e
    join loyalty_programs p on p.establishment_id = e.id
    where e.id = ${session.establishmentId}
      and p.active = true
    limit 1
  `;

  if (!restaurant) redirect("/dashboard");

  const base = getAppUrl() || "http://localhost:3000";
  const url = `${base}/j/${restaurant.slug}`;
  const qr = await QRCode.toDataURL(url, { width: 900, margin: 1, errorCorrectionLevel: "M" });
  const unit = restaurant.unit_label
    ? programUnits(restaurant.mode, restaurant.unit_label, restaurant.unit_label_plural).plural
    : restaurant.mode === "STAMPS" ? "passages" : "points";
  const domain = new URL(base).host;

  return <PosterView
    name={String(restaurant.name)}
    logoUrl={restaurant.logo_url ? String(restaurant.logo_url) : null}
    primaryColor={String(restaurant.primary_color || "#111111")}
    rewardThreshold={Number(restaurant.reward_threshold)}
    rewardLabel={String(restaurant.reward_label)}
    unit={unit}
    qr={qr}
    joinUrl={url}
    domain={domain}
  />;
}

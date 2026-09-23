import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavMenu } from "@/components/mobile-nav-menu";
import { APP_NAV_LINKS } from "@/lib/app-nav-links";
import { getSession } from "@/lib/auth";
import { getBillingAccess } from "@/lib/billing";

export async function AppNav({ restaurantName }: { restaurantName?: string }) {
  const session = await getSession();
  const links = session
    ? APP_NAV_LINKS.filter((link) => link.roles.includes(session.role))
    : [];
  const access = session ? await getBillingAccess(session.establishmentId) : null;

  return <><header className="topbar no-print"><div className="shell topbar-inner"><Link className="brand" href={session?.role === "EMPLOYEE" ? "/s" : "/dashboard"}>{restaurantName || "Retiko"}</Link><nav className="navlinks">
    {links.map((link) => <Link key={link.href} href={link.href} className={link.keepMobile ? "keep-mobile" : undefined}>{link.label}</Link>)}
    <MobileNavMenu links={links}/>
    <LogoutButton/>
  </nav></div></header>{access && !access.operational && <div className="billing-alert no-print"><div className="shell"><strong>Fonctions de fidélité suspendues.</strong> L’essai est terminé ou l’abonnement nécessite votre attention. {session?.role === "OWNER" || session?.role === "MANAGER" ? <Link href="/dashboard/billing">Activer l’abonnement</Link> : "Contactez le responsable du commerce."}</div></div>}</>;
}

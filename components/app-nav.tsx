import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavMenu } from "@/components/mobile-nav-menu";
import { APP_NAV_LINKS } from "@/lib/app-nav-links";
import { getSession } from "@/lib/auth";

export async function AppNav({ restaurantName }: { restaurantName?: string }) {
  const session = await getSession();
  const links = session
    ? APP_NAV_LINKS.filter((link) => link.roles.includes(session.role))
    : [];

  return <header className="topbar no-print"><div className="shell topbar-inner"><Link className="brand" href={session?.role === "EMPLOYEE" ? "/s" : "/dashboard"}>{restaurantName || "Retiko"}</Link><nav className="navlinks">
    {links.map((link) => <Link key={link.href} href={link.href} className={link.keepMobile ? "keep-mobile" : undefined}>{link.label}</Link>)}
    <MobileNavMenu links={links}/>
    <LogoutButton/>
  </nav></div></header>;
}

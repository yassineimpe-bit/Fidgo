import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavMenu } from "@/components/mobile-nav-menu";
import { APP_NAV_LINKS } from "@/lib/app-nav-links";

export function AppNav({ restaurantName }: { restaurantName?: string }) {
  return <header className="topbar no-print"><div className="shell topbar-inner"><Link className="brand" href="/dashboard">{restaurantName || "Retiko"}</Link><nav className="navlinks">
    {APP_NAV_LINKS.map((link) => <Link key={link.href} href={link.href} className={link.keepMobile ? "keep-mobile" : undefined}>{link.label}</Link>)}
    <MobileNavMenu/>
    <LogoutButton/>
  </nav></div></header>;
}

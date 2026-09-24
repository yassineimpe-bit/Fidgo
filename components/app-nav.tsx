import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavMenu } from "@/components/mobile-nav-menu";
import { AppNavList } from "@/components/app-nav-list";
import { APP_NAV_LINKS } from "@/lib/app-nav-links";
import { getSession } from "@/lib/auth";

export async function AppNav({ restaurantName }: { restaurantName?: string }) {
  const session = await getSession();
  const links = session
    ? APP_NAV_LINKS.filter((link) => link.roles.includes(session.role))
    : [];
  const scanner = links.find((link) => link.href === "/s");

  return <header className="app-sidebar no-print">
    <div className="app-sidebar-inner">
      <div className="app-sidebar-head">
        <Link className="brand" href={session?.role === "EMPLOYEE" ? "/s" : "/dashboard"}>
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-copy">{restaurantName || "Retiko"}</span>
        </Link>
        {scanner ? <Link className="app-nav-mobile-primary" href="/s">Scanner</Link> : null}
        <MobileNavMenu links={links}/>
      </div>
      <AppNavList links={links}/>
      <div className="app-sidebar-footer">
        <LogoutButton/>
      </div>
    </div>
  </header>;
}

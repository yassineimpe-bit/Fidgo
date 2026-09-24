"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string; keepMobile?: boolean };

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/s") return pathname === "/s" || pathname.startsWith("/s/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNavList({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return <nav className="app-sidebar-links" aria-label="Navigation commerçant">
    {links.map((link) => {
      const active = isActive(pathname, link.href);
      const className = [
        "app-sidebar-link",
        link.href === "/s" ? "app-sidebar-link-primary" : "",
        active ? "is-active" : "",
      ].filter(Boolean).join(" ");

      return <Link key={link.href} href={link.href} className={className} aria-current={active ? "page" : undefined}>{link.label}</Link>;
    })}
  </nav>;
}

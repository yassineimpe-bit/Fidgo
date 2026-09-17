"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { APP_NAV_LINKS } from "@/lib/app-nav-links";
import { LogoutButton } from "@/components/logout-button";

/**
 * En dessous de 820px, .navlinks masque tout sauf Scanner (voir globals.css) :
 * sans ce menu, un restaurateur mobile n'a aucun moyen d'atteindre Clients,
 * Programme, Équipe, Commerce, Wallet ou l'affiche QR autrement qu'en tapant
 * l'URL à la main.
 */
export function MobileNavMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="nav-menu">
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="mobile-nav-dropdown"
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "✕" : "☰"}</span>
      </button>
      <div id="mobile-nav-dropdown" className={open ? "nav-dropdown nav-open" : "nav-dropdown"}>
        {APP_NAV_LINKS.filter((link) => !link.keepMobile).map((link) => (
          <Link key={link.href} href={link.href}>{link.label}</Link>
        ))}
        {/* Déconnexion est masqué en dehors de ce menu sur mobile (voir globals.css) : dupliqué ici pour rester atteignable. */}
        <LogoutButton/>
      </div>
    </div>
  );
}

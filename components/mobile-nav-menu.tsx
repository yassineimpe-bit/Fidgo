"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { groupMobileNavLinks, type AppNavGroup } from "@/lib/app-nav-links";

type MobileLink = { href: string; label: string; keepMobile?: boolean; group: AppNavGroup };

export function MobileNavMenu({ links }: { links: MobileLink[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const groups = groupMobileNavLinks(links);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Le focus revient au bouton plutôt que de se perdre dans un menu masqué.
      toggleRef.current?.focus();
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
        ref={toggleRef}
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
        {groups.map((group) => (
          <div key={group.id} className="nav-group" role="group" aria-labelledby={`nav-group-${group.id}`}>
            <p className="nav-group-title" id={`nav-group-${group.id}`}>{group.label}</p>
            {group.links.map((link) => (
              <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>
            ))}
          </div>
        ))}
        <LogoutButton/>
      </div>
    </div>
  );
}

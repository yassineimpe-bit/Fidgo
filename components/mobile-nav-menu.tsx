"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoutButton } from "@/components/logout-button";

type MobileLink = { href: string; label: string; keepMobile?: boolean };

export function MobileNavMenu({ links }: { links: MobileLink[] }) {
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
        {links.filter((link) => !link.keepMobile).map((link) => (
          <Link key={link.href} href={link.href}>{link.label}</Link>
        ))}
        <LogoutButton/>
      </div>
    </div>
  );
}

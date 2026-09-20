"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/legal/mentions-legales", "Mentions légales"],
  ["/legal/cgu", "CGU"],
  ["/legal/cgv", "CGV"],
  ["/legal/confidentialite", "Confidentialité"],
  ["/legal/cookies", "Cookies"],
] as const;

export function LegalFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/s/")) return null;

  return (
    <footer
      style={{
        maxWidth: 1000,
        margin: "0 auto",
        padding: "20px",
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        justifyContent: "center",
        fontSize: 13,
      }}
    >
      {links.map(([href, label]) => <Link key={href} href={href} className="muted">{label}</Link>)}
    </footer>
  );
}

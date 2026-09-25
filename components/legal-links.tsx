import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal";

const ITEMS = [
  [LEGAL_LINKS.notice, "Mentions légales"],
  [LEGAL_LINKS.cgu, "CGU"],
  [LEGAL_LINKS.cgv, "CGV"],
  [LEGAL_LINKS.privacy, "Confidentialité"],
  [LEGAL_LINKS.cookies, "Cookies"],
] as const;

export function LegalLinks({ only }: { only?: (typeof ITEMS)[number][0][] }) {
  const items = only ? ITEMS.filter(([href]) => only.includes(href)) : ITEMS;
  return <nav className="legal-links" aria-label="Informations légales">
    {items.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
  </nav>;
}

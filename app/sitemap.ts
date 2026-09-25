import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/app-url";
import { LEGAL_LINKS } from "@/lib/legal";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getAppUrl() || "https://retiko.fr";
  const pages = ["/", "/signup", "/login", ...Object.values(LEGAL_LINKS)];
  return pages.map((path) => ({ url: `${base}${path}`, changeFrequency: path === "/" ? "weekly" : "monthly", priority: path === "/" ? 1 : 0.5 }));
}

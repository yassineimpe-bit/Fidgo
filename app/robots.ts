import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/app-url";

/** Seules les pages publiques sont indexables ; les cartes et l'espace commerçant, jamais. */
export default function robots(): MetadataRoute.Robots {
  const base = getAppUrl() || "https://retiko.fr";
  return {
    rules: [{
      userAgent: "*",
      allow: ["/", "/signup", "/login", "/legal/"],
      disallow: ["/api/", "/c/", "/j/", "/s", "/dashboard", "/onboarding", "/admin", "/recover", "/reset-password", "/verify-email", "/forgot-password", "/offline", "/unsubscribe"],
    }],
    sitemap: `${base}/sitemap.xml`,
  };
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Retiko",
    short_name: "Retiko",
    description: "Carte de fidélité digitale et scanner commerçant",
    start_url: "/s",
    display: "standalone",
    background_color: "#020203",
    theme_color: "#020203",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  };
}

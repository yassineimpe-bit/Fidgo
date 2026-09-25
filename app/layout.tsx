import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { ClientObservability } from "@/components/client-observability";
import { getAppUrl } from "@/lib/app-url";

// Les nonces CSP sont générés à chaque requête. Le rendu dynamique garantit
// que chaque balise script reçoit le nonce correspondant à son en-tête HTTP.
export const dynamic = "force-dynamic";

// Sans viewportFit:"cover", iOS ne détend jamais le viewport sous l'encoche
// ou la barre d'accueil : tous les env(safe-area-inset-*) déjà posés dans
// globals.css (scanner, topbar) restaient à 0 et n'avaient aucun effet réel.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020203",
};

export const metadata: Metadata = {
  // URL absolues des balises canonical / Open Graph.
  metadataBase: new URL(getAppUrl() || "https://retiko.fr"),
  title: { default: "Retiko", template: "%s · Retiko" },
  description: "Fidélité digitale pour restaurants et commerces alimentaires",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Retiko",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body><PwaRegister /><ClientObservability />{children}</body></html>;
}

import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { ClientObservability } from "@/components/client-observability";

// Les nonces CSP sont générés à chaque requête. Le rendu dynamique garantit
// que chaque balise script reçoit le nonce correspondant à son en-tête HTTP.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Retiko", template: "%s · Retiko" },
  description: "Fidélité digitale pour restaurants et commerces alimentaires",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Retiko",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body><PwaRegister /><ClientObservability />{children}</body></html>;
}

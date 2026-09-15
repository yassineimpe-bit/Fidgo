import type { Metadata } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: { default: "Fidgo", template: "%s · Fidgo" },
  description: "Fidélité digitale pour restaurants et commerces alimentaires",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body><PwaRegister />{children}</body></html>;
}

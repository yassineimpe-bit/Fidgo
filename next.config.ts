import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      // Android Trusted Web Activity: Android/Chrome exige ce chemin exact
      // pour vérifier que retiko.fr et l'application appartiennent au même éditeur.
      { source: "/.well-known/assetlinks.json", destination: "/api/android/assetlinks" },
    ];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Les pages carte portent un secret dans l'URL : jamais de cache partage.
      { source: "/c/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // Le jeton de récupération est un secret à usage unique : ne jamais le
      // mettre en cache, l'envoyer comme referrer ou l'indexer.
      {
        source: "/recover/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      // Le lien de vérification transporte lui aussi un secret à usage unique.
      {
        source: "/verify-email",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      // Le lien de désabonnement identifie un client : ni cache, ni referrer, ni index.
      {
        source: "/unsubscribe/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      // Le jeton de réinitialisation de mot de passe est également un secret
      // à usage unique porté par l'URL (?token=...).
      {
        source: "/reset-password",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;

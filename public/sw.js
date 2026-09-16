const CACHE = "retiko-shell-v3";
const SHELL = [
  "/",
  "/login",
  "/signup",
  "/offline",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("retiko-shell-") && key !== CACHE)
          .map((key) => caches.delete(key))
      )),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Les pages métier et cartes peuvent contenir des données personnelles.
  // On ne les met jamais en cache. En cas de coupure, une navigation affiche
  // uniquement la page neutre hors-ligne.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match("/offline");
        return offline || Response.error();
      })
    );
    return;
  }

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});

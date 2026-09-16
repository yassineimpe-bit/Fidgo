"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "retiko:pwa-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || Boolean(nav.standalone);
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Bandeau discret d'installation PWA : jamais bloquant, jamais répété une fois fermé. */
export function PwaInstallHint({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [dismissed, setDismissed] = useState(true);
  const [iosHint, setIosHint] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let alreadyDismissed = false;
    try {
      alreadyDismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    if (isStandalone() || alreadyDismissed) return;
    setDismissed(false);
    if (isIos()) setIosHint(true);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
    dismiss();
  }

  if (dismissed || (!iosHint && !installEvent)) return null;

  const style = tone === "dark"
    ? { background: "rgba(18,18,20,.96)", color: "white", border: "1px solid rgba(255,255,255,.14)" }
    : { background: "#fff", color: "inherit", border: "1px solid var(--line)" };

  return <div className="no-print" style={{ ...style, borderRadius: 16, padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
    <div style={{ fontSize: 13.5, maxWidth: 420 }}>
      {installEvent
        ? "Installe Retiko sur ce téléphone pour l’ouvrir en un tap, comme une vraie app."
        : "Sur iPhone : touche Partager puis « Sur l’écran d’accueil » pour installer Retiko."}
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      {installEvent && <button className="btn btn-primary" type="button" onClick={install}>Installer Retiko</button>}
      <button className="btn" type="button" onClick={dismiss}>{installEvent ? "Plus tard" : "Compris"}</button>
    </div>
  </div>;
}

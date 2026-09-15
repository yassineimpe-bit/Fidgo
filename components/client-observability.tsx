"use client";

import { useEffect } from "react";

const sent = new Set<string>();

export function reportClientError(error: unknown, digest?: string) {
  const value = error instanceof Error ? error : new Error(String(error || "Unknown client error"));
  const key = `${value.name}:${value.message}:${digest || ""}`;
  if (sent.has(key)) return;
  sent.add(key);
  if (sent.size > 50) sent.delete(sent.values().next().value as string);

  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: value.name,
      message: value.message,
      digest,
      path: window.location.pathname,
    }),
  }).catch(() => undefined);
}

export function ClientObservability() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError(event.error || event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

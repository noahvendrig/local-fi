"use client";

import { useEffect } from "react";

// Registers public/sw.js once the app has hydrated. Skipped outside production — the file
// only exists to make installability/offline-shell caching real for a built app, and fighting
// a stale cached bundle against Turbopack's dev HMR would be pure friction with no benefit.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a nice-to-have, not a hard requirement — swallow registration
      // failures (e.g. served over plain HTTP on a LAN address) rather than surfacing an error.
    });
  }, []);

  return null;
}

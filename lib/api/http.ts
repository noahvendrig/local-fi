import { useAuthStore } from "@/lib/store/auth";
import { useDeviceStore } from "@/lib/store/device";

/** A paired phone's device token (mobile plan Phase B) takes priority over the static token
 *  when present — the single chokepoint that makes every existing API call work unmodified
 *  for a paired device, since lib/auth/verifyToken.ts accepts either. */
function currentToken(): string {
  return useDeviceStore.getState().device?.deviceToken ?? useAuthStore.getState().token;
}

/** The paired PC's origin, or "" when there's none — same-origin apps (the existing LAN mobile
 *  view) never pair a device, so this is always "" there and every apiUrl() below is a no-op. */
function apiBase(): string {
  return useDeviceStore.getState().device?.serverUrl ?? "";
}

/** Prefixes a relative API path with the paired device's origin (standalone PWA), or leaves it
 *  untouched for a same-origin caller (the existing LAN mobile view, where apiBase() is always
 *  ""). The chokepoint that makes cross-origin pairing work at all — every relative fetch to
 *  `/api/v1/...` should be routed through this. */
export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

export function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${currentToken()}` };
}

/** Appends `?token=` for endpoints native browser APIs (EventSource, <audio>, <img>) can't attach
 *  headers to. Routes through apiUrl() so every existing withAuthQuery(relativePath) call site
 *  (cover art <img>s, media-session artwork, export download links, ...) becomes cross-origin-safe
 *  automatically, with no changes needed at those call sites. */
export function withAuthQuery(url: string): string {
  const absolute = apiUrl(url);
  const separator = absolute.includes("?") ? "&" : "?";
  return `${absolute}${separator}token=${encodeURIComponent(currentToken())}`;
}

/** True once there's a usable credential to call the API with — either a paired device (the
 *  standalone PWA's only path to credentials) or the same-origin static token (always present
 *  in the existing LAN mobile/desktop view, seeded server-side by AuthTokenProvider). Gating
 *  queries on this — not on "paired" alone — keeps the already-working same-origin app's
 *  queries firing unconditionally exactly as they do today, while still gating the standalone
 *  app off until it's actually paired. */
export function hasCredentials(): boolean {
  return useDeviceStore.getState().device !== null || useAuthStore.getState().token !== "";
}

/** Reactive form of hasCredentials() for use inside React components/query `enabled` checks. */
export function useHasCredentials(): boolean {
  const hasDevice = useDeviceStore((s) => s.device !== null);
  const hasStaticToken = useAuthStore((s) => s.token !== "");
  return hasDevice || hasStaticToken;
}

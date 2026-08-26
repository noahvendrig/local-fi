import { useAuthStore } from "@/lib/store/auth";
import { useDeviceStore } from "@/lib/store/device";

/** A paired phone's device token (mobile plan Phase B) takes priority over the static token
 *  when present — the single chokepoint that makes every existing API call work unmodified
 *  for a paired device, since lib/auth/verifyToken.ts accepts either. */
function currentToken(): string {
  return useDeviceStore.getState().device?.deviceToken ?? useAuthStore.getState().token;
}

export function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${currentToken()}` };
}

/** Appends `?token=` for endpoints native browser APIs (EventSource, <audio>, <img>) can't attach headers to. */
export function withAuthQuery(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(currentToken())}`;
}

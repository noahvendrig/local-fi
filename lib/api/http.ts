import { useAuthStore } from "@/lib/store/auth";

export function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${useAuthStore.getState().token}` };
}

/** Appends `?token=` for endpoints native browser APIs (EventSource, <audio>, <img>) can't attach headers to. */
export function withAuthQuery(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(useAuthStore.getState().token)}`;
}

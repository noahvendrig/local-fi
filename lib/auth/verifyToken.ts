import { eq } from "drizzle-orm";
import { getAuthToken } from "./token";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

const DEVICE_LAST_SEEN_THROTTLE_MS = 60_000;

/** Bumps a paired device's lastSeenAt, at most once a minute, so this stays a cheap
 *  no-op on the hot path (audio Range requests hit this many times per track). */
function touchDeviceLastSeen(deviceId: number, lastSeenAt: string | null): void {
  if (lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < DEVICE_LAST_SEEN_THROTTLE_MS) return;
  getDb().update(devices).set({ lastSeenAt: new Date().toISOString() }).where(eq(devices.id, deviceId)).run();
}

/** True if `token` matches an unrevoked paired device — the fallback path checked only
 *  after the static token misses, so desktop's existing behavior stays a zero-DB-hit check. */
function isValidDeviceToken(token: string): boolean {
  const device = getDb().select().from(devices).where(eq(devices.token, token)).get();
  if (!device || device.revokedAt) return false;
  touchDeviceLastSeen(device.id, device.lastSeenAt);
  return true;
}

/**
 * Accepts either `Authorization: Bearer <token>` or a `?token=` query param.
 * The query-param fallback exists because native <audio>/<img> elements can't
 * attach custom headers (ARCHITECTURE.md §8). A token can be the single static token
 * (Stage 1) or a paired device's token (mobile plan Phase B) — checked in that order.
 */
export function isAuthorized(request: Request): boolean {
  const expected = getAuthToken();

  const authHeader = request.headers.get("authorization");
  let presented: string | null = null;
  if (authHeader) {
    const [scheme, value] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value) presented = value;
  }
  if (!presented) {
    const url = new URL(request.url);
    presented = url.searchParams.get("token");
  }
  if (!presented) return false;

  if (presented === expected) return true;
  return isValidDeviceToken(presented);
}

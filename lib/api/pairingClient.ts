import { apiUrl, authHeaders } from "./http";

export interface PairingStartResult {
  code: string;
  expiresAt: string;
  lanUrl: string;
  pairingUrl: string;
  qrDataUrl: string;
}

export interface PairingStatusResult {
  status: "pending" | "completed" | "expired" | "not_found";
  device: { id: number; name: string; pairedAt: string } | null;
}

export interface PairedDevice {
  id: number;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

export interface PairingCompleteResult {
  deviceId: number;
  deviceToken: string;
  deviceName: string;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

/** PC-side: mint a fresh code + QR for the Devices modal. */
export function startPairing(): Promise<PairingStartResult> {
  return fetch(apiUrl("/api/v1/pairing/start"), { method: "POST", headers: authHeaders() }).then((res) =>
    parseJsonOrThrow(res)
  );
}

/** PC-side: poll while a code is shown, to flip the modal to "paired" once a phone completes it. */
export function getPairingStatus(code: string): Promise<PairingStatusResult> {
  return fetch(apiUrl(`/api/v1/pairing/status?code=${encodeURIComponent(code)}`), { headers: authHeaders() }).then(
    (res) => parseJsonOrThrow(res)
  );
}

export function listPairedDevices(): Promise<{ items: PairedDevice[] }> {
  return fetch(apiUrl("/api/v1/pairing/devices"), { headers: authHeaders() }).then((res) => parseJsonOrThrow(res));
}

export function revokeDevice(id: number): Promise<void> {
  return fetch(apiUrl(`/api/v1/pairing/devices/${id}`), { method: "DELETE", headers: authHeaders() }).then((res) => {
    if (!res.ok) throw new Error(`Failed to unpair (${res.status})`);
  });
}

/** Phone-side: deliberately no auth header — this is the one call a device makes before it has a
 *  token. `origin`, when given, targets that PC directly (the standalone PWA's flow — no device
 *  is paired yet, so apiUrl()'s apiBase() has nothing to route through) instead of the default
 *  relative same-origin request the existing LAN mobile view's `/pair` page still makes. */
export function completePairing(code: string, deviceName?: string, origin?: string): Promise<PairingCompleteResult> {
  const url = origin ? `${origin}/api/v1/pairing/complete` : "/api/v1/pairing/complete";
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  }).then((res) => parseJsonOrThrow(res));
}

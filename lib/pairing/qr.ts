import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

// Interface-name patterns that are almost never the address a phone on the same physical
// Wi-Fi can actually reach — WSL/Hyper-V/Docker/VM virtual bridges in particular are common
// enough (and enumerated before the real adapter often enough, as on the dev machine this was
// written against — a WSL vEthernet adapter sorted first ahead of Wi-Fi) that picking "the
// first non-internal IPv4" naively hands out a dead-end QR code.
const VIRTUAL_ADAPTER_PATTERN = /vethernet|virtual|vmware|virtualbox|hyper-v|docker|wsl|loopback/i;

/**
 * Best-guess LAN address for this machine — the first non-internal IPv4 on a plausibly-physical
 * adapter. Genuine multi-NIC ambiguity (two real Wi-Fi/Ethernet adapters both up) can still pick
 * the wrong one; the address is also shown as plain text next to the QR so the user can correct
 * it, rather than building NIC-picker UI for what's a rarer case than the virtual-adapter one.
 */
export function detectLanAddress(): string | null {
  const candidates: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (VIRTUAL_ADAPTER_PATTERN.test(name)) continue;
      candidates.push(addr.address);
    }
  }
  if (candidates.length > 0) return candidates[0];

  // Every candidate looked virtual — fall back to any non-internal IPv4 rather than nothing.
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

/** Origin the PC's server is reachable at from another device on the same LAN, e.g. "http://192.168.1.42:3000". */
export function buildLanOrigin(request: Request): string | null {
  const address = detectLanAddress();
  if (!address) return null;
  const port = new URL(request.url).port || "3000";
  return `http://${address}:${port}`;
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

/** Data URL (PNG) for a QR encoding the pairing URL — scannable by a phone's OS camera app with no in-app code. */
export function generatePairingQrDataUrl(pairingUrl: string): Promise<string> {
  return QRCode.toDataURL(pairingUrl, { margin: 1, width: 320, color: { dark: "#1B1815", light: "#F7F3EA" } });
}

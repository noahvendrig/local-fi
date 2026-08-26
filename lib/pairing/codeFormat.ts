// Pure string formatting shared by server routes and client pairing UI — kept out of
// lib/pairing/code.ts because that file also pulls in node:crypto for code generation, which
// can't go in a client bundle.

/** Normalizes user-typed/scanned input (case/hyphen-insensitive) to the canonical stored form. */
export function normalizePairingCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped.length !== 8) return stripped;
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
}

/** Normalizes a manually-typed PC address ("192.168.1.42:3000", or a full "http://..." URL)
 *  into an origin string — the standalone PWA's fallback for pairing when scanning isn't an
 *  option (mirrors the existing LAN mobile view's manual-code-entry fallback, which needs no
 *  address since it's always same-origin there). Returns null for empty/unparseable input. */
export function normalizeServerAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

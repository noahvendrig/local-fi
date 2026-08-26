// Pure string formatting shared by server routes and client pairing UI — kept out of
// lib/pairing/code.ts because that file also pulls in node:crypto for code generation, which
// can't go in a client bundle.

/** Normalizes user-typed/scanned input (case/hyphen-insensitive) to the canonical stored form. */
export function normalizePairingCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stripped.length !== 8) return stripped;
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
}

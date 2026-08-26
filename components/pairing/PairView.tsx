"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { completePairing } from "@/lib/api/pairingClient";
import { normalizePairingCode, normalizeServerAddress } from "@/lib/pairing/codeFormat";
import { useDeviceStore } from "@/lib/store/device";
import { CodeEntry } from "./CodeEntry";
import { QrScanner, extractCodeFromScan, extractOriginFromScan } from "./QrScanner";

// Standalone PWAs (served from a static host, not the PC) have no same-origin address to fall
// back on — pairing there needs an explicit PC address, scanned or typed. The existing LAN
// mobile view is unaffected: it's always loaded *from* the PC, so window.location.origin
// already is the right address and this whole extra step never appears there.
const STANDALONE = process.env.NEXT_PUBLIC_STANDALONE === "true";

// Mobile "Pair with a computer" screen (design board 1c "m-pair scan" frame). Reachable two
// ways: scanned via the phone's OS camera app (the QR encodes a plain URL to this exact page
// with ?code= prefilled — no in-app camera code needed for first pairing at all), or opened
// from inside an already-installed PWA to re-pair, where the in-app QrScanner below is the
// point. Either way it's the same code, same submit path.
export function PairView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setPaired = useDeviceStore((s) => s.setPaired);

  const [code, setCode] = useState(() => normalizePairingCode(searchParams.get("code") ?? ""));
  const [scannedOrigin, setScannedOrigin] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  async function submit(rawCode: string, origin: string | null) {
    const normalized = normalizePairingCode(rawCode);
    if (normalized.replace("-", "").length !== 8 || submittedRef.current) return;
    if (STANDALONE && !origin) {
      setStatus("error");
      setError("Enter the PC's address below first.");
      return;
    }
    submittedRef.current = true;
    setStatus("submitting");
    setError(null);
    try {
      const result = await completePairing(normalized, undefined, origin ?? undefined);
      setPaired({
        deviceId: result.deviceId,
        serverUrl: origin ?? window.location.origin,
        deviceToken: result.deviceToken,
        deviceName: result.deviceName,
        pairedAt: new Date().toISOString(),
      });
      setStatus("done");
      router.push("/");
    } catch (err) {
      submittedRef.current = false;
      setStatus("error");
      setError(err instanceof Error ? err.message : "Pairing failed.");
    }
  }

  function resolvedOrigin(): string | null {
    if (!STANDALONE) return null; // submit() falls back to window.location.origin itself
    return scannedOrigin ?? normalizeServerAddress(manualAddress);
  }

  // Auto-submit once a full code is present. Driven from the actual change events (typing/
  // pasting completing the code, a scan resolving) rather than a useEffect keyed on `code` —
  // an effect calling setState the instant it observes a "complete" value is the exact
  // cascading-render pattern react-hooks/set-state-in-effect flags; doing it inside the event
  // handler that produced the value is the same behavior without that. The one exception is a
  // code arriving pre-filled from the ?code= query param, handled once on mount below.
  function handleCodeChange(next: string) {
    setCode(next);
    if (next.replace("-", "").length === 8) void submit(next, resolvedOrigin());
  }

  function handleScan(payload: string) {
    const origin = extractOriginFromScan(payload);
    if (origin) setScannedOrigin(origin);
    const next = normalizePairingCode(extractCodeFromScan(payload));
    setCode(next);
    if (next.replace("-", "").length === 8) void submit(next, origin ?? resolvedOrigin());
  }

  function handleManualAddressChange(next: string) {
    setManualAddress(next);
    setScannedOrigin(null);
    const normalized = normalizeServerAddress(next);
    if (normalized && code.replace("-", "").length === 8) void submit(code, normalized);
  }

  // Submits a code that arrived pre-filled via ?code= exactly once on mount — not a reactive
  // sync loop, so the setState-in-effect concern the lint rule targets doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!STANDALONE && code.replace("-", "").length === 8) void submit(code, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, deliberately not re-running when `code` changes afterward
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-5 py-6">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">Pair with a computer</p>
      <h1 className="text-2xl font-bold leading-[1.2] text-t1">Point at the QR code</h1>
      <p className="mt-1.5 font-mono text-xs text-t3">Open local‑fi on your PC → Devices</p>

      <div className="mt-4">
        <QrScanner onScan={handleScan} />
      </div>

      {STANDALONE ? (
        <div className="mt-4 rounded-2xl border border-line bg-surf p-3.5">
          <p className="mb-2.5 text-sm text-t1">Server address</p>
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="192.168.1.42:3000"
            value={manualAddress}
            onChange={(e) => handleManualAddressChange(e.target.value)}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm text-t1 outline-none focus:border-acc"
          />
          <p className="mt-1.5 font-mono text-[11px] text-t3">
            Shown on the PC&apos;s Devices screen — required since this app isn&apos;t loaded from the PC itself.
          </p>
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-line bg-surf p-3.5">
        <p className="mb-2.5 text-sm text-t1">Enter code instead</p>
        <CodeEntry value={code} onChange={handleCodeChange} />
        <p className="mt-2.5 font-mono text-[11px] text-t3">
          {status === "submitting" ? "Pairing…" : status === "error" && error ? error : "Same Wi‑Fi only"}
        </p>
      </div>
    </div>
  );
}

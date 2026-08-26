"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { completePairing } from "@/lib/api/pairingClient";
import { normalizePairingCode } from "@/lib/pairing/codeFormat";
import { useDeviceStore } from "@/lib/store/device";
import { CodeEntry } from "./CodeEntry";
import { QrScanner, extractCodeFromScan } from "./QrScanner";

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
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  async function submit(rawCode: string) {
    const normalized = normalizePairingCode(rawCode);
    if (normalized.replace("-", "").length !== 8 || submittedRef.current) return;
    submittedRef.current = true;
    setStatus("submitting");
    setError(null);
    try {
      const result = await completePairing(normalized);
      setPaired({
        deviceId: result.deviceId,
        serverUrl: window.location.origin,
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

  // Auto-submit once a full code is present. Driven from the actual change events (typing/
  // pasting completing the code, a scan resolving) rather than a useEffect keyed on `code` —
  // an effect calling setState the instant it observes a "complete" value is the exact
  // cascading-render pattern react-hooks/set-state-in-effect flags; doing it inside the event
  // handler that produced the value is the same behavior without that. The one exception is a
  // code arriving pre-filled from the ?code= query param, handled once on mount below.
  function handleCodeChange(next: string) {
    setCode(next);
    if (next.replace("-", "").length === 8) void submit(next);
  }

  // Submits a code that arrived pre-filled via ?code= exactly once on mount — not a reactive
  // sync loop, so the setState-in-effect concern the lint rule targets doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code.replace("-", "").length === 8) void submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, deliberately not re-running when `code` changes afterward
  }, []);

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-5 py-6">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">Pair with a computer</p>
      <h1 className="text-2xl font-bold leading-[1.2] text-t1">Point at the QR code</h1>
      <p className="mt-1.5 font-mono text-xs text-t3">Open local‑fi on your PC → Devices</p>

      <div className="mt-4">
        <QrScanner onScan={(payload) => handleCodeChange(normalizePairingCode(extractCodeFromScan(payload)))} />
      </div>

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

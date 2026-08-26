"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPairingStatus,
  listPairedDevices,
  revokeDevice,
  startPairing,
  type PairingStartResult,
} from "@/lib/api/pairingClient";

const POLL_MS = 2500;

function formatCountdown(expiresAt: string): { label: string; expired: boolean } {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return { label: "expired", expired: true };
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return { label: `expires in ${m}:${s.toString().padStart(2, "0")}`, expired: false };
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 90_000) return "active now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Desktop "Devices" modal (design board 1c "PAIRING") — QR + human-typeable code on the left/
// right, a live countdown, and the paired-devices list below. Polls pairing/status while a code
// is showing so the modal flips to reflect a phone completing pairing without a manual refresh.
export function PairingModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<PairingStartResult | null>(null);
  const [, forceTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startMutation = useMutation({
    mutationFn: startPairing,
    onSuccess: (result) => setSession(result),
  });
  const mintCode = startMutation.mutate;

  const devicesQuery = useQuery({ queryKey: ["pairing", "devices"], queryFn: listPairedDevices });

  const revokeMutation = useMutation({
    mutationFn: revokeDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pairing", "devices"] }),
  });

  useEffect(() => {
    mintCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount only
  }, []);

  // Re-render every second so the countdown label stays live without a separate timer store.
  useEffect(() => {
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!session) return;
    pollRef.current = setInterval(async () => {
      const status = await getPairingStatus(session.code).catch(() => null);
      if (status?.status === "completed") {
        clearInterval(pollRef.current!);
        queryClient.invalidateQueries({ queryKey: ["pairing", "devices"] });
        // Mint a fresh code immediately rather than clearing the QR to a dead placeholder —
        // the modal should stay ready to pair a second phone ("Scan again to add another
        // phone", per the design's own qrHint copy) without the user hunting for "New code".
        mintCode();
      }
    }, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mintCode is `.mutate`, a stable TanStack Query reference; the mutation object itself isn't included to avoid re-running this on every status change
  }, [session, queryClient]);

  const countdown = session ? formatCountdown(session.expiresAt) : null;
  const devices = devicesQuery.data?.items ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Devices"
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-line bg-surf shadow-[var(--lf-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-5">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">Devices</p>
            <h2 className="font-serif text-2xl font-medium text-t1">
              {devices.length > 0 ? `${devices.length} phone${devices.length === 1 ? "" : "s"} paired` : "Scan to pair"}
            </h2>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-t3 hover:bg-surf-2 hover:text-t1"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-6 px-6 py-6 sm:flex-row">
          <div className="w-full shrink-0 sm:w-[236px]">
            <div className="rounded-2xl border border-line p-3.5 shadow-[var(--lf-art-shadow)]" style={{ background: "#F7F3EA" }}>
              {session ? (
                // eslint-disable-next-line @next/next/no-img-element -- generated QR data URL, not an optimizable remote image
                <img src={session.qrDataUrl} alt="Pairing QR code" className="aspect-square w-full" />
              ) : (
                <div className="grid aspect-square w-full place-items-center text-xs text-t3">
                  {startMutation.isPending ? "Generating…" : "—"}
                </div>
              )}
            </div>
            <p className="mt-2.5 text-center text-[10.5px] text-t3">Camera → point at this code</p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">Server address</p>
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-sm text-t1">{session?.lanUrl ?? "—"}</span>
                <span className="shrink-0 rounded-md bg-surf-2 px-1.5 py-0.5 font-mono text-[10px] text-t3">LAN</span>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">Pairing code</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xl font-medium tracking-[0.14em] text-t1">{session?.code ?? "——··——"}</span>
                {countdown ? (
                  <span className={`font-mono text-[11px] ${countdown.expired ? "text-err" : "text-t3"}`}>{countdown.label}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-t2 hover:border-acc hover:text-t1 disabled:opacity-50"
                >
                  New code
                </button>
              </div>
              <p className="mt-2 max-w-[340px] text-[11px] leading-normal text-t3">
                Type the code manually if the camera can&rsquo;t read the QR. One scan carries both the address and the code, so
                the phone finds this machine and authenticates in one step.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-bg px-3.5 py-3">
              <p className="text-xs leading-normal text-t2">
                Both devices must be on the same Wi&#8209;Fi network. Access from outside the LAN — VPN or tunnel — is not part
                of this version.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-line px-6 py-5">
          <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-t3">Paired devices</p>
          {devices.length === 0 ? (
            <p className="text-sm text-t3">No phones paired yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="grid grid-cols-[8px_1fr_auto_auto] items-center gap-3.5 rounded-lg border border-line bg-bg px-3.5 py-3"
                >
                  <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />
                  <span className="min-w-0 truncate text-sm text-t1">{device.name}</span>
                  <span className="font-mono text-[11px] text-t3">{formatRelative(device.lastSeenAt)}</span>
                  <button
                    type="button"
                    onClick={() => revokeMutation.mutate(device.id)}
                    disabled={revokeMutation.isPending}
                    className="text-[11px] font-medium text-t3 hover:text-err disabled:opacity-50"
                  >
                    Unpair
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

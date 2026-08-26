"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { revokeDevice } from "@/lib/api/pairingClient";
import { useDeviceStore } from "@/lib/store/device";

// Mobile counterpart of the desktop "Devices" modal — the phone only ever tracks its own single
// pairing, not a list, so this is deliberately simpler than PairingModal.tsx's QR/code-issuing
// UI. Desktop-only otherwise (md:hidden): the nav-rail "Pair a phone" item covers that surface.
export function MobileDevicesSection() {
  const device = useDeviceStore((s) => s.device);
  const clearPairing = useDeviceStore((s) => s.clearPairing);

  const forgetMutation = useMutation({
    mutationFn: async () => {
      if (device) await revokeDevice(device.deviceId).catch(() => undefined);
    },
    onSuccess: () => clearPairing(),
  });

  return (
    <section className="mb-8 md:hidden">
      <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Devices</h2>
      {device ? (
        <div className="lf-card mt-3 flex items-center gap-3 rounded-2xl px-4 py-3.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-t1">Paired</p>
            <p className="truncate font-mono text-xs text-t3">{device.serverUrl.replace(/^https?:\/\//, "")}</p>
          </div>
          <button
            type="button"
            onClick={() => forgetMutation.mutate()}
            disabled={forgetMutation.isPending}
            className="shrink-0 text-xs font-medium text-t3 hover:text-err disabled:opacity-50"
          >
            Forget
          </button>
        </div>
      ) : (
        <Link
          href="/pair"
          className="lf-top mt-3 flex items-center justify-center gap-2 rounded-lg border border-acc bg-acc px-4 py-3 text-sm font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2"
        >
          Pair with a computer
        </Link>
      )}
    </section>
  );
}

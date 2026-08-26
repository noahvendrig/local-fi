"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { copyCrateToPhone, isCrateOffline, removeCrateOffline } from "@/lib/offline/copyToPhone";
import { useOfflineCopyStore } from "@/lib/store/offlineCopy";
import { DownloadIcon } from "@/components/shell/PlayerIcons";

// Mobile-only "Copy to phone" control (design board 1c "m-copy offline" frame) — folded into
// the existing crate detail action row rather than a separate screen: same information (per-
// asset-type success counts, total size), less new UI surface. md:hidden since desktop already
// has full access to the library and has no use for an offline copy of it.
export function MobileOfflineButton({ crateId, crateName }: { crateId: number; crateName: string }) {
  const queryClient = useQueryClient();
  const offlineQuery = useQuery({ queryKey: ["offline", "crate", crateId], queryFn: () => isCrateOffline(crateId) });
  const progress = useOfflineCopyStore((s) => s.progress[crateId]);
  const clearProgress = useOfflineCopyStore((s) => s.clearProgress);

  async function handleCopy() {
    try {
      await copyCrateToPhone(crateId);
      queryClient.invalidateQueries({ queryKey: ["offline", "crate", crateId] });
    } catch {
      // Progress store already has the error; the button below renders it.
    }
  }

  async function handleRemove() {
    await removeCrateOffline(crateId);
    clearProgress(crateId);
    queryClient.invalidateQueries({ queryKey: ["offline", "crate", crateId] });
  }

  if (progress?.status === "copying") {
    const pct = progress.totalTracks > 0 ? Math.round((progress.completedTracks / progress.totalTracks) * 100) : 0;
    return (
      <div className="lf-card w-full rounded-2xl px-4 py-3.5 md:hidden">
        <div className="mb-2 flex items-center justify-between text-sm text-t1">
          <span>Copying to phone…</span>
          <span className="font-mono text-xs text-t3">
            {progress.completedTracks}/{progress.totalTracks}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-sm bg-surf-2">
          <div className="h-full rounded-sm bg-playing transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        {progress.currentTrackTitle ? <p className="mt-2 truncate font-mono text-xs text-t3">{progress.currentTrackTitle}</p> : null}
      </div>
    );
  }

  if (progress?.status === "error") {
    return (
      <div className="w-full md:hidden">
        <button
          type="button"
          onClick={handleCopy}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-err px-4 py-3 text-sm font-medium text-err"
        >
          Copy failed — tap to retry
        </button>
        <p className="mt-1.5 text-center text-xs text-t3">{progress.error}</p>
      </div>
    );
  }

  if (offlineQuery.data) {
    return (
      <div className="lf-card flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 md:hidden">
        <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-t1">Available offline</p>
          {progress?.status === "done" ? (
            <p className="font-mono text-[11px] text-ok">
              ✓ {progress.tracksOk} tracks · ✓ {progress.coversOk} covers · ✓ {progress.waveformsOk} waveforms
            </p>
          ) : null}
        </div>
        <button type="button" onClick={handleRemove} className="shrink-0 text-xs font-medium text-t3 hover:text-err">
          Remove
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy ${crateName} to phone`}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-4 py-3 text-sm font-medium text-t1 hover:border-acc hover:bg-surf-2 md:hidden"
    >
      <DownloadIcon />
      Copy to phone
    </button>
  );
}

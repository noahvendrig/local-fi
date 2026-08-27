"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { importLocalFiles, type LocalImportResult } from "@/lib/offline/localImport";

// Mobile-only local-import fallback (mobile plan Phase D2, design board 1c "m1 onboarding"
// frame's "Choose a folder" intent, adapted to individual files since directory pickers are
// unreliable on iOS Safari) — for a user who never gets the PC server running at all. Picked
// files are parsed and stored entirely client-side (lib/offline/localImport.ts); browsing what
// landed here happens on the Library tab's "All songs" segment (which merges on-device tracks
// with the paired PC's library) rather than duplicating that list in two places.
export function MobileLocalImportSection() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<LocalImportResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setIsImporting(true);
    setResult(null);
    setFatalError(null);
    try {
      const outcome = await importLocalFiles(files);
      setResult(outcome);
      queryClient.invalidateQueries({ queryKey: ["offline"] });
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="mt-8 md:hidden">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-xl font-semibold leading-[1.3] text-t1">Import from this phone</h2>
      </div>
      <p className="mt-1.5 text-sm text-t2">
        No PC server needed — files are read and stored on this phone only. See them under Library →
        All songs.
      </p>

      <input ref={inputRef} type="file" multiple accept="audio/*" className="hidden" onChange={handleFiles} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isImporting}
        className="lf-top mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-acc bg-acc px-4 py-3 text-sm font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2 disabled:opacity-50"
      >
        {isImporting ? "Importing…" : "Choose audio files"}
      </button>

      {result ? (
        <p className="mt-3 text-center font-mono text-xs text-t3">
          {result.imported.length} imported
          {result.failed.length > 0 ? ` · ${result.failed.length} failed` : ""}
        </p>
      ) : null}
      {fatalError ? <p className="mt-3 text-center text-xs text-err">{fatalError}</p> : null}
    </section>
  );
}

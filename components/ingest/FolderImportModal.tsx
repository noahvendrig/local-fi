"use client";

import { useMemo } from "react";
import { sourceFolderOf } from "@/lib/ingest/collectFiles";
import { useIngestStore } from "@/lib/store/ingest";

/**
 * Shown when a dropped/chosen folder has subfolders — the user picks whether each
 * subfolder becomes its own playlist, or everything just lands in the library flat
 * (AGENTS.md import behavior).
 */
export function FolderImportModal() {
  const pending = useIngestStore((s) => s.pendingFolderImport);
  const resolveFolderImport = useIngestStore((s) => s.resolveFolderImport);
  const cancelFolderImport = useIngestStore((s) => s.cancelFolderImport);

  const folderNames = useMemo(() => {
    if (!pending) return [];
    const names = new Set<string>();
    for (const entry of pending) {
      const folder = sourceFolderOf(entry);
      if (folder) names.add(folder);
    }
    return Array.from(names);
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import folder with subfolders"
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,.6))" }}
      onClick={cancelFolderImport}
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-line bg-surf p-6 shadow-[var(--lf-shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-medium text-t1">This folder has subfolders</h2>
        <p className="mt-2 text-sm text-t2">
          {folderNames.length > 0
            ? `Found ${folderNames.length} subfolder${folderNames.length === 1 ? "" : "s"}: ${folderNames.slice(0, 3).join(", ")}${folderNames.length > 3 ? ", …" : ""}.`
            : "Some files are inside subfolders."}{" "}
          How should they be imported?
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void resolveFolderImport(true)}
            className="rounded-lg border border-acc bg-[var(--lf-tint)] px-3 py-2.5 text-left text-sm text-t1 hover:bg-acc/10"
          >
            <span className="font-medium">Create a playlist per subfolder</span>
            <span className="mt-0.5 block text-xs text-t3">Each subfolder becomes its own playlist, named after the folder.</span>
          </button>
          <button
            type="button"
            onClick={() => void resolveFolderImport(false)}
            className="rounded-lg border border-line px-3 py-2.5 text-left text-sm text-t1 hover:bg-surf-2"
          >
            <span className="font-medium">Import everything into the library</span>
            <span className="mt-0.5 block text-xs text-t3">All files are added directly, without creating playlists.</span>
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={cancelFolderImport} className="rounded-md border border-line px-3 py-1.5 text-sm text-t1 hover:bg-surf-2">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

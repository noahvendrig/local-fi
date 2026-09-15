"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteMixtape, fetchMixtapes, uploadMixtape, type Mixtape } from "@/lib/api/mixtapesClient";
import { formatDuration } from "@/lib/format/track";
import { ConfirmDialog } from "@/components/shell/ConfirmDialog";

const STATUS_LABEL: Record<string, string> = {
  pending: "Not analyzed",
  queued: "Queued",
  analyzing: "Analyzing…",
  ready: "Analyzed",
  failed: "Analysis failed",
};

export function MixtapesView() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<Mixtape | null>(null);

  const mixtapesQuery = useQuery({ queryKey: ["mixtapes"], queryFn: fetchMixtapes });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadMixtape(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mixtapes"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMixtape(id),
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["mixtapes"] });
    },
  });

  const items = mixtapesQuery.data?.items ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-[1.2] text-t1">Mixtapes</h1>
          <p className="mt-1 text-sm text-t2">
            Upload a DJ mix or mixtape and it&apos;s automatically segmented and matched against your local library.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="lf-top shrink-0 rounded-lg border border-acc bg-acc px-4 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2 disabled:opacity-50"
        >
          {uploadMutation.isPending ? "Uploading…" : "Upload mixtape"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) uploadMutation.mutate(file);
          }}
        />
      </div>

      {uploadMutation.isError ? <p className="mt-3 text-xs text-err">{(uploadMutation.error as Error).message}</p> : null}
      {deleteMutation.isError ? <p className="mt-3 text-xs text-err">{(deleteMutation.error as Error).message}</p> : null}

      {mixtapesQuery.isLoading ? (
        <p className="mt-8 text-sm text-t3">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <p className="font-serif text-2xl text-t1">No mixtapes yet</p>
          <p className="max-w-sm text-sm text-t2">
            Upload a DJ set and local-fi will find which of your tracks appear in it, tolerant of pitch/tempo shifts.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2.5">
          {items.map((mixtape) => (
            <li key={mixtape.id} className="lf-card flex items-center gap-3.5 rounded-lg px-3.5 py-3.5">
              <Link href={`/mixtapes/${mixtape.id}`} className="min-w-0 flex-1">
                <p className="truncate text-sm text-t1">{mixtape.title}</p>
                <p className="truncate font-mono text-xs text-t3">
                  {formatDuration(mixtape.durationSeconds)} · {mixtape.format.toUpperCase()}
                </p>
              </Link>
              <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-t2">
                {STATUS_LABEL[mixtape.analysisStatus] ?? mixtape.analysisStatus}
              </span>
              <button
                type="button"
                onClick={() => setDeleteTarget(mixtape)}
                className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-t2 hover:border-err hover:text-err"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete mixtape"
          message={`Permanently delete "${deleteTarget.title}"? This removes the uploaded file and all segment matches. This can't be undone.`}
          confirmLabel="Delete"
          danger
          isPending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}

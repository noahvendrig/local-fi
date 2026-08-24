import type { ImportJobFile } from "@/lib/api/types";

const STATUS_LABEL: Record<ImportJobFile["status"], string> = {
  queued: "Queued",
  reading_tags: "Reading tags…",
  transcoding_waveform: "Analyzing audio…",
  saving: "Saving…",
  done: "Imported",
  failed: "Failed",
  duplicate_skipped: "Duplicate of existing file",
};

const STATUS_PROGRESS: Record<ImportJobFile["status"], number> = {
  queued: 0,
  reading_tags: 25,
  transcoding_waveform: 62,
  saving: 85,
  done: 100,
  failed: 12,
  duplicate_skipped: 100,
};

const ACTIVE_STATUSES = new Set(["reading_tags", "transcoding_waveform", "saving"]);

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(filename: string): string {
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toUpperCase() : "";
}

function statusColor(file: ImportJobFile): string {
  if (file.status === "failed") return "var(--lf-err)";
  if (file.status === "duplicate_skipped") return "var(--lf-warn)";
  if (file.status === "done") return "var(--lf-ok)";
  if (ACTIVE_STATUSES.has(file.status)) return "var(--lf-playing)";
  return "var(--lf-t3)";
}

function waveColor(file: ImportJobFile): string {
  if (file.status === "done") return "var(--lf-playing)";
  if (file.status === "duplicate_skipped") return "var(--lf-warn)";
  return "var(--lf-t3)";
}

export function JobFileRow({ file }: { file: ImportJobFile }) {
  const color = statusColor(file);
  const progress = STATUS_PROGRESS[file.status];
  const format = extOf(file.originalFilename);
  const label = file.status === "failed" && file.errorMessage ? file.errorMessage : STATUS_LABEL[file.status];

  return (
    <li className="lf-top grid grid-cols-[44px_minmax(0,1fr)_minmax(80px,150px)_92px_74px] items-center gap-3.5 rounded-lg border border-line bg-surf px-3 py-3">
      <div
        className="h-8 rounded opacity-90"
        style={{
          background: `repeating-linear-gradient(90deg, ${waveColor(file)}, ${waveColor(file)} 2px, transparent 2px, transparent 4px)`,
        }}
        aria-hidden
      />

      <div className="min-w-0">
        <p className="truncate text-sm text-t1" title={file.originalFilename}>
          {file.originalFilename}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs" style={{ color }} title={label}>
          {label}
        </p>
      </div>

      <div className="h-1 overflow-hidden rounded-sm bg-surf-2">
        <div className="h-full rounded-sm transition-all duration-300" style={{ width: `${progress}%`, background: color }} />
      </div>

      <span className="font-mono text-xs text-t3">{format || "—"}</span>
      <span className="text-right font-mono text-xs text-t3">{formatBytes(file.bytesTotal)}</span>
    </li>
  );
}

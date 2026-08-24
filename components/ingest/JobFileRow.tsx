import type { ImportJobFile } from "@/lib/api/types";

const STATUS_LABEL: Record<ImportJobFile["status"], string> = {
  queued: "Queued",
  reading_tags: "Reading tags",
  transcoding_waveform: "Analyzing audio",
  saving: "Saving",
  done: "Imported",
  failed: "Failed",
  duplicate_skipped: "Duplicate",
};

const STATUS_PROGRESS: Record<ImportJobFile["status"], number> = {
  queued: 0,
  reading_tags: 25,
  transcoding_waveform: 60,
  saving: 85,
  done: 100,
  failed: 100,
  duplicate_skipped: 100,
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(filename: string): string {
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toUpperCase() : "";
}

const ACTIVE_STATUSES = new Set(["reading_tags", "transcoding_waveform", "saving"]);

export function JobFileRow({ file }: { file: ImportJobFile }) {
  const isFailed = file.status === "failed";
  const isDone = file.status === "done";
  const isActive = ACTIVE_STATUSES.has(file.status);
  const progress = STATUS_PROGRESS[file.status];

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <MiniWaveform active={isActive} failed={isFailed} done={isDone} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-t1" title={file.originalFilename}>
          {file.originalFilename}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surf-2">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isFailed ? "bg-err" : isDone ? "bg-ok" : "bg-acc"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-t3">{formatBytes(file.bytesTotal)}</span>
        </div>
        {isFailed && file.errorMessage ? (
          <p className="mt-0.5 truncate text-xs text-err" title={file.errorMessage}>
            {file.errorMessage}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-t3">
            {STATUS_LABEL[file.status]}
            {extOf(file.originalFilename) ? ` · ${extOf(file.originalFilename)}` : ""}
          </p>
        )}
      </div>
    </li>
  );
}

function MiniWaveform({ active, failed, done }: { active: boolean; failed: boolean; done: boolean }) {
  const bars = [4, 9, 6, 12, 5, 8];
  const color = failed ? "bg-err" : done ? "bg-ok" : "bg-t3";
  return (
    <div className="flex h-6 w-8 shrink-0 items-center justify-center gap-[2px]" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className={`w-[2px] rounded-full ${color} ${active ? "animate-pulse" : ""}`}
          style={{ height: `${h}px`, animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

export type ImportJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

export type ImportJobFileStatus =
  | "queued"
  | "reading_tags"
  | "transcoding_waveform"
  | "saving"
  | "done"
  | "failed"
  | "duplicate_skipped";

export interface ImportJobFile {
  id: number;
  jobId: number;
  originalFilename: string;
  stagedPath: string | null;
  sourceFolder: string | null;
  /** Set on `folder_scan` files — which watched library root this file belongs to. */
  libraryRootId: number | null;
  trackId: number | null;
  status: ImportJobFileStatus;
  errorMessage: string | null;
  bytesTotal: number | null;
  bytesProcessed: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportJob {
  id: number;
  uuid: string;
  type: "upload" | "scan" | "folder_scan";
  status: ImportJobStatus;
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ImportJobWithFiles extends ImportJob {
  files: ImportJobFile[];
}

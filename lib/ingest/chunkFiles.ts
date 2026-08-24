import type { CollectedFile } from "./collectFiles";

// Keep each POST well under the proxy body limit and avoid stuffing a whole
// library into one FormData. A file larger than the budget is sent alone.
const MAX_BATCH_BYTES = 32 * 1024 * 1024;

export function chunkFilesForUpload(files: CollectedFile[], maxBytes = MAX_BATCH_BYTES): CollectedFile[][] {
  const batches: CollectedFile[][] = [];
  let current: CollectedFile[] = [];
  let currentBytes = 0;

  for (const entry of files) {
    if (current.length > 0 && currentBytes + entry.file.size > maxBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += entry.file.size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

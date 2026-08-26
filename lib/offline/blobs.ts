import { blobKey, getOfflineDb } from "./db";

type BlobKind = "audio" | "cover" | "waveform";

export async function writeBlob(trackId: number, kind: BlobKind, blob: Blob): Promise<void> {
  const db = await getOfflineDb();
  await db.put("blobs", blob, blobKey(trackId, kind));
}

export async function readBlob(trackId: number, kind: BlobKind): Promise<Blob | undefined> {
  const db = await getOfflineDb();
  return db.get("blobs", blobKey(trackId, kind));
}

export async function deleteBlob(trackId: number, kind: BlobKind): Promise<void> {
  const db = await getOfflineDb();
  await db.delete("blobs", blobKey(trackId, kind));
}

/** Surfaced before starting a large copy so the UI can warn if there's not much room left —
 *  not enforced (the browser will fail writes on its own if it runs out), just informational. */
export async function estimateStorage(): Promise<{ usageBytes: number; quotaBytes: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (usage == null || quota == null) return null;
    return { usageBytes: usage, quotaBytes: quota };
  } catch {
    return null;
  }
}

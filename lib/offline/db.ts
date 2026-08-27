import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * A track cached on-device (mobile plan Phase C/D) — either copied from the PC ("synced",
 * `id` is the real server track id so it round-trips cleanly with TrackSummary) or picked
 * straight from the phone's own storage ("local", `id` is a client-generated negative number,
 * since it has no server row at all). Keeping both kinds in the same numeric `id` space — real
 * ids positive, local ids negative — means every surface that already works with a plain
 * `TrackSummary.id` (the player store, queue, etc.) needs no special-casing later in Phase E.
 */
export interface OfflineTrack {
  id: number;
  uuid: string;
  title: string | null;
  artistName: string | null;
  albumTitle: string | null;
  durationSeconds: number;
  format: string;
  lossless: boolean;
  hasCover: boolean;
  hasWaveform: boolean;
  source: "synced" | "local";
  /** Original filename for a locally-imported track — the only way to know its extension
   *  later (e.g. when uploading it back to the PC), since there's no server `format` field. */
  sourceFilename: string | null;
  addedAt: string;
}

export interface OfflineCrate {
  id: number;
  name: string;
  trackIds: number[];
  copiedAt: string;
  /**
   * How this crate got here. `"synced"` (or absent, for records written before this field
   * existed) is a read-only copy of a PC playlist — `id` is the real server playlist id.
   * `"local"` is a crate made on the phone itself with no PC involved (standalone build only);
   * `id` is a client-generated negative number, mirroring how local-only tracks are keyed
   * (lib/offline/localImport.ts), and its tracks are edited entirely client-side.
   */
  origin?: "synced" | "local";
  /** Last client-side edit to a `"local"` crate (add/remove track, rename). */
  updatedAt?: string;
}

type BlobKind = "audio" | "cover" | "waveform";

interface LfOfflineSchema extends DBSchema {
  tracks: { key: number; value: OfflineTrack };
  crates: { key: number; value: OfflineCrate };
  blobs: { key: string; value: Blob };
}

let dbPromise: Promise<IDBPDatabase<LfOfflineSchema>> | null = null;

export function getOfflineDb(): Promise<IDBPDatabase<LfOfflineSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<LfOfflineSchema>("lf-offline", 1, {
      upgrade(db) {
        db.createObjectStore("tracks", { keyPath: "id" });
        db.createObjectStore("crates", { keyPath: "id" });
        db.createObjectStore("blobs");
      },
    });
  }
  return dbPromise;
}

export function blobKey(trackId: number, kind: BlobKind): string {
  return `${trackId}:${kind}`;
}

export async function putOfflineTrack(track: OfflineTrack): Promise<void> {
  const db = await getOfflineDb();
  await db.put("tracks", track);
}

export async function getOfflineTrack(id: number): Promise<OfflineTrack | undefined> {
  const db = await getOfflineDb();
  return db.get("tracks", id);
}

export async function getAllOfflineTracks(): Promise<OfflineTrack[]> {
  const db = await getOfflineDb();
  return db.getAll("tracks");
}

export async function deleteOfflineTrack(id: number): Promise<void> {
  const db = await getOfflineDb();
  const tx = db.transaction(["tracks", "blobs"], "readwrite");
  await tx.objectStore("tracks").delete(id);
  await Promise.all(
    (["audio", "cover", "waveform"] as const).map((kind) => tx.objectStore("blobs").delete(blobKey(id, kind))),
  );
  await tx.done;
}

export async function putOfflineCrate(crate: OfflineCrate): Promise<void> {
  const db = await getOfflineDb();
  await db.put("crates", crate);
}

export async function getOfflineCrate(id: number): Promise<OfflineCrate | undefined> {
  const db = await getOfflineDb();
  return db.get("crates", id);
}

export async function getAllOfflineCrates(): Promise<OfflineCrate[]> {
  const db = await getOfflineDb();
  return db.getAll("crates");
}

export async function deleteOfflineCrateRecord(id: number): Promise<void> {
  const db = await getOfflineDb();
  await db.delete("crates", id);
}

/** True if any *other* offline crate still references this track — the gate before deleting
 *  its blobs when removing one crate's download, so a track shared across two copied crates
 *  doesn't lose its audio out from under the other crate. */
export async function isTrackReferencedByAnyCrate(trackId: number, exceptCrateId?: number): Promise<boolean> {
  const crates = await getAllOfflineCrates();
  return crates.some((crate) => crate.id !== exceptCrateId && crate.trackIds.includes(trackId));
}

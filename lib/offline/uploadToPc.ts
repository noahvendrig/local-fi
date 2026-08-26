import { useIngestStore } from "@/lib/store/ingest";
import { readBlob } from "./blobs";
import { deleteOfflineTrack, getOfflineTrack } from "./db";

/**
 * Phone → PC (mobile plan Phase D1): hands a locally-imported track's audio blob to the exact
 * same upload pipeline the desktop folder-import UI already uses (`useIngestStore.submitFiles`)
 * — same staging → job → worker machinery server-side, completely unmodified, since a paired
 * phone is just another authenticated caller of `POST /api/v1/import` per Phase B. Only offered
 * for `source: 'local'` tracks — uploading a track that was itself copied *from* the PC would
 * be a pointless round-trip.
 */
export async function uploadLocalTrackToPc(trackId: number): Promise<void> {
  const track = await getOfflineTrack(trackId);
  if (!track || track.source !== "local") return;
  const blob = await readBlob(trackId, "audio");
  if (!blob) throw new Error("This track's audio isn't in offline storage anymore.");

  const filename = track.sourceFilename ?? `${track.title ?? "track"}.${track.format}`;
  const file = new File([blob], filename, { type: blob.type });
  await useIngestStore.getState().submitFiles([{ file, relativePath: filename }]);
}

/** Removes a locally-imported track from the phone once it's been uploaded (or just to free space) — no server-side effect, since it never had a server row of its own. */
export async function removeLocalTrack(trackId: number): Promise<void> {
  await deleteOfflineTrack(trackId);
}

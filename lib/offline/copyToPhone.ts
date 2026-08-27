import { streamUrl, waveformUrl, type TrackSummary } from "@/lib/api-client";
import { fetchPlaylist } from "@/lib/api/playlistsClient";
import { withAuthQuery } from "@/lib/api/http";
import { useOfflineCopyStore } from "@/lib/store/offlineCopy";
import { writeBlob } from "./blobs";
import {
  deleteOfflineCrateRecord,
  deleteOfflineTrack,
  getOfflineCrate,
  isTrackReferencedByAnyCrate,
  putOfflineCrate,
  putOfflineTrack,
} from "./db";

async function copyOneTrack(track: TrackSummary): Promise<{ bytes: number; hadCover: boolean; hadWaveform: boolean }> {
  const audioRes = await fetch(streamUrl(track.id));
  if (!audioRes.ok) throw new Error(`Couldn't download "${track.title ?? "track"}" (${audioRes.status}).`);
  const audioBlob = await audioRes.blob();
  await writeBlob(track.id, "audio", audioBlob);

  let hadCover = false;
  if (track.coverArtUrl) {
    const coverRes = await fetch(withAuthQuery(track.coverArtUrl));
    if (coverRes.ok) {
      await writeBlob(track.id, "cover", await coverRes.blob());
      hadCover = true;
    }
  }

  let hadWaveform = false;
  const waveformRes = await fetch(waveformUrl(track.id));
  if (waveformRes.ok) {
    await writeBlob(track.id, "waveform", await waveformRes.blob());
    hadWaveform = true;
  }

  await putOfflineTrack({
    id: track.id,
    uuid: track.uuid,
    title: track.title,
    artistName: track.artistName,
    albumTitle: track.albumTitle,
    durationSeconds: track.durationSeconds,
    format: track.format,
    lossless: track.lossless,
    hasCover: hadCover,
    hasWaveform: hadWaveform,
    source: "synced",
    sourceFilename: null,
    addedAt: new Date().toISOString(),
  });

  return { bytes: audioBlob.size, hadCover, hadWaveform };
}

/**
 * PC → phone (mobile plan Phase C): pulls a crate's tracks, covers, and waveform sidecars into
 * IndexedDB one track at a time — sequential, not parallel, so progress reporting stays accurate
 * and a slow phone connection doesn't try to hold a dozen in-flight blob downloads at once.
 * No resumability: a copy interrupted partway through (screen lock, backgrounded tab) just
 * leaves the crate un-recorded and some loose track rows, safely re-copyable from scratch.
 */
export async function copyCrateToPhone(crateId: number): Promise<void> {
  const store = useOfflineCopyStore.getState();
  const playlist = await fetchPlaylist(crateId);
  store.startCopy(crateId, playlist.name, playlist.tracks.length);

  try {
    const trackIds: number[] = [];
    for (const track of playlist.tracks) {
      if (track.missing) continue;
      const result = await copyOneTrack(track);
      trackIds.push(track.id);
      store.reportTrack(crateId, { trackTitle: track.title ?? "Untitled", bytes: result.bytes, hadCover: result.hadCover, hadWaveform: result.hadWaveform });
    }

    await putOfflineCrate({ id: crateId, name: playlist.name, trackIds, copiedAt: new Date().toISOString() });
    store.finishCopy(crateId);
  } catch (err) {
    store.failCopy(crateId, err instanceof Error ? err.message : "Copy failed.");
    throw err;
  }
}

export async function isCrateOffline(crateId: number): Promise<boolean> {
  return (await getOfflineCrate(crateId)) !== undefined;
}

/** Removes a crate's offline copy — track blobs only where no other offline crate still needs them. */
export async function removeCrateOffline(crateId: number): Promise<void> {
  const crate = await getOfflineCrate(crateId);
  if (!crate) return;
  // A locally-made crate owns no downloads — its tracks are ordinary on-device songs that live
  // in "All songs" independently — so deleting it must never reach into the blob store.
  if (crate.origin === "local") {
    await deleteOfflineCrateRecord(crateId);
    return;
  }
  for (const trackId of crate.trackIds) {
    const stillNeeded = await isTrackReferencedByAnyCrate(trackId, crateId);
    if (stillNeeded) continue;
    await deleteOfflineTrack(trackId); // also clears its audio/cover/waveform blobs
  }
  await deleteOfflineCrateRecord(crateId);
}

import { writeBlob } from "./blobs";
import { putOfflineTrack, type OfflineTrack } from "./db";

// Local-only track ids are negative so they share the same `id: number` space as real server
// ids (positive) without ever colliding — every surface built around TrackSummary.id (queue,
// player store) needs no separate "is this local" branch as a result. Seeded from the current
// time so ids stay unique across page reloads without a persisted counter.
let localIdCounter = 0;
function generateLocalTrackId(): number {
  localIdCounter += 1;
  return -(Date.now() * 1000 + localIdCounter);
}

function formatFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : "mp3";
}

export interface LocalImportResult {
  imported: OfflineTrack[];
  failed: { filename: string; error: string }[];
}

/**
 * Phone-only local library fallback (mobile plan Phase D2) — for a user who never gets the PC
 * server running. Reads tags client-side via music-metadata's browser-safe `parseBlob` (no
 * write path needed here, unlike the server's node-taglib-sharp pipeline — mobile is read-only
 * per the agreed scope). Deliberately does not attempt waveform generation: that needs
 * AudioContext decode + bucketing work the plan explicitly defers, so these tracks just play
 * with a plain progress bar instead of a waveform scrubber until that lands.
 */
export async function importLocalFiles(files: File[]): Promise<LocalImportResult> {
  const { parseBlob } = await import("music-metadata");
  const imported: OfflineTrack[] = [];
  const failed: { filename: string; error: string }[] = [];

  for (const file of files) {
    try {
      const metadata = await parseBlob(file, { duration: true });
      const id = generateLocalTrackId();

      await writeBlob(id, "audio", file);

      const picture = metadata.common.picture?.[0];
      let hasCover = false;
      if (picture) {
        await writeBlob(id, "cover", new Blob([picture.data.slice()], { type: picture.format }));
        hasCover = true;
      }

      const track: OfflineTrack = {
        id,
        uuid: crypto.randomUUID(),
        title: metadata.common.title ?? file.name.replace(/\.[^.]+$/, ""),
        artistName: metadata.common.artist ?? null,
        albumTitle: metadata.common.album ?? null,
        durationSeconds: metadata.format.duration ?? 0,
        format: formatFromFilename(file.name),
        lossless: metadata.format.lossless ?? false,
        hasCover,
        hasWaveform: false,
        source: "local",
        sourceFilename: file.name,
        addedAt: new Date().toISOString(),
      };
      await putOfflineTrack(track);
      imported.push(track);
    } catch (err) {
      failed.push({ filename: file.name, error: err instanceof Error ? err.message : "Couldn't read this file." });
    }
  }

  return { imported, failed };
}

import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { mixtapes, tracks } from "@/lib/db/schema";
import { getDataDir } from "@/lib/storage/dataDir";

/**
 * Hard-deletes a mixtape and its companion library track together (removing the audio + waveform
 * + cover art files and both rows) — they share one physical audio file (see the schema comment
 * on `mixtapes`), so neither can be removed without the other. Called both from
 * DELETE /api/v1/mixtapes/:id and, when a client instead deletes the companion track from the
 * regular library, from DELETE /api/v1/tracks/:id. Returns false if the mixtape no longer exists.
 */
export function deleteMixtapeCascade(mixtapeId: number): boolean {
  const db = getDb();
  const existing = db.select().from(mixtapes).where(eq(mixtapes.id, mixtapeId)).get();
  if (!existing) return false;

  const dataDir = getDataDir();
  const audioPath = path.join(dataDir, existing.path);
  if (existsSync(audioPath)) rmSync(path.dirname(audioPath), { recursive: true, force: true });
  if (existing.waveformPath) {
    const waveformPath = path.join(dataDir, existing.waveformPath);
    if (existsSync(waveformPath)) rmSync(waveformPath, { force: true });
  }

  if (existing.libraryTrackId != null) {
    const libraryTrack = db.select().from(tracks).where(eq(tracks.id, existing.libraryTrackId)).get();
    if (libraryTrack?.coverArtPath) {
      const coverArtPath = path.join(dataDir, libraryTrack.coverArtPath);
      if (existsSync(coverArtPath)) rmSync(coverArtPath, { force: true });
    }
  }

  db.transaction((tx) => {
    if (existing.libraryTrackId != null) {
      tx.delete(tracks).where(eq(tracks.id, existing.libraryTrackId)).run();
    }
    tx.delete(mixtapes).where(eq(mixtapes.id, mixtapeId)).run();
  });

  return true;
}

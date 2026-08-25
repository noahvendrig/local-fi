import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { analysisJobTracks, analysisJobs, tracks } from "../db/schema";
import { resolveTrackAbsPath } from "../storage/resolveTrackPath";
import { publishAnalysisJobUpdate } from "./events";
import { detectBpm } from "./bpmDetect";
import { detectKey } from "./keyDetect";
import { ANALYSIS_SAMPLE_RATE, decodeMonoPcmF32 } from "./pcmDecode";

/**
 * Analyzes one track: decodes it once, fills in whichever of bpm/key is still missing (tag and
 * manual values always win — detection never overwrites an existing value, only gaps), and
 * writes the result straight to the DB. Unlike tag edits, detected values are never written back
 * to the file — the file stays the source of truth only for what's actually tagged.
 */
export async function analyzeTrack(trackId: number, jobTrackId: number, jobId: number): Promise<void> {
  const db = getDb();
  const now = () => new Date().toISOString();

  db.update(analysisJobTracks).set({ status: "analyzing", updatedAt: now() }).where(eq(analysisJobTracks.id, jobTrackId)).run();
  db.update(tracks).set({ analysisStatus: "analyzing" }).where(eq(tracks.id, trackId)).run();
  publishAnalysisJobUpdate(jobId);

  try {
    const track = db.select().from(tracks).where(eq(tracks.id, trackId)).get();
    if (!track) throw new Error("Track not found");

    const needsBpm = track.bpm == null;
    const needsKey = track.key == null;

    let bpm = track.bpm;
    let bpmSource = track.bpmSource;
    let key = track.key;
    let keySource = track.keySource;

    if (needsBpm || needsKey) {
      const absPath = resolveTrackAbsPath(track);
      const samples = await decodeMonoPcmF32(absPath, ANALYSIS_SAMPLE_RATE);

      if (needsBpm) {
        const detected = detectBpm(samples, ANALYSIS_SAMPLE_RATE);
        if (detected != null) {
          bpm = detected;
          bpmSource = "detected";
        }
      }
      if (needsKey) {
        const detected = detectKey(samples, ANALYSIS_SAMPLE_RATE);
        if (detected != null) {
          key = detected;
          keySource = "detected";
        }
      }
    }

    db.update(tracks)
      .set({ bpm, bpmSource, key, keySource, analysisStatus: "ready", analysisError: null, analyzedAt: now() })
      .where(eq(tracks.id, trackId))
      .run();
    db.update(analysisJobTracks).set({ status: "done", updatedAt: now() }).where(eq(analysisJobTracks.id, jobTrackId)).run();
    db.update(analysisJobs)
      .set({ processedTracks: sql`${analysisJobs.processedTracks} + 1` })
      .where(eq(analysisJobs.id, jobId))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    db.update(tracks).set({ analysisStatus: "failed", analysisError: message }).where(eq(tracks.id, trackId)).run();
    db.update(analysisJobTracks)
      .set({ status: "failed", errorMessage: message, updatedAt: now() })
      .where(eq(analysisJobTracks.id, jobTrackId))
      .run();
    db.update(analysisJobs)
      .set({ processedTracks: sql`${analysisJobs.processedTracks} + 1`, failedTracks: sql`${analysisJobs.failedTracks} + 1` })
      .where(eq(analysisJobs.id, jobId))
      .run();
  }

  publishAnalysisJobUpdate(jobId);
}

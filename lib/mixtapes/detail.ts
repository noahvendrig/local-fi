import { eq } from "drizzle-orm";
import type { TrackSummary } from "../api-client";
import { getDb } from "../db/client";
import { mixtapeJobs, mixtapeSegments, mixtapes } from "../db/schema";
import { getTrackSummariesByIds } from "../db/trackSummary";

export interface MixtapeSegmentDetail {
  id: number;
  startSeconds: number;
  endSeconds: number;
  matchedTrackId: number | null;
  matchStatus: string;
  confidenceScore: number | null;
  matchedTempoRatio: number | null;
  sourceStartSeconds: number | null;
  position: number;
  matchedTrack: TrackSummary | null;
}

export interface MixtapeDetail {
  id: number;
  uuid: string;
  title: string;
  originalFilename: string;
  fileSizeBytes: number;
  durationSeconds: number;
  format: string;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  waveformStatus: string;
  waveformPeakCount: number | null;
  waveformAvgLevel: number | null;
  analysisStatus: string;
  latestJob: typeof mixtapeJobs.$inferSelect | null;
  createdAt: string;
  updatedAt: string;
  segments: MixtapeSegmentDetail[];
}

/** Resolves one mixtape's full detail — segments joined with the local track they matched (if
 *  any) — for the /mixtapes/:id detail page and its underlying GET route. */
export function loadMixtapeDetail(mixtapeId: number): MixtapeDetail | null {
  const db = getDb();
  const mixtape = db.select().from(mixtapes).where(eq(mixtapes.id, mixtapeId)).get();
  if (!mixtape) return null;

  const segmentRows = db
    .select()
    .from(mixtapeSegments)
    .where(eq(mixtapeSegments.mixtapeId, mixtapeId))
    .all()
    .sort((a, b) => a.position - b.position);

  const trackIds = [...new Set(segmentRows.map((s) => s.matchedTrackId).filter((id): id is number => id != null))];
  const trackById = new Map(getTrackSummariesByIds(db, trackIds).map((t) => [t.id, t]));

  const latestJob = mixtape.latestJobId ? (db.select().from(mixtapeJobs).where(eq(mixtapeJobs.id, mixtape.latestJobId)).get() ?? null) : null;

  return {
    id: mixtape.id,
    uuid: mixtape.uuid,
    title: mixtape.title,
    originalFilename: mixtape.originalFilename,
    fileSizeBytes: mixtape.fileSizeBytes,
    durationSeconds: mixtape.durationSeconds,
    format: mixtape.format,
    codec: mixtape.codec,
    bitrate: mixtape.bitrate,
    sampleRate: mixtape.sampleRate,
    waveformStatus: mixtape.waveformStatus,
    waveformPeakCount: mixtape.waveformPeakCount,
    waveformAvgLevel: mixtape.waveformAvgLevel,
    analysisStatus: mixtape.analysisStatus,
    latestJob,
    createdAt: mixtape.createdAt,
    updatedAt: mixtape.updatedAt,
    segments: segmentRows.map((s) => ({
      id: s.id,
      startSeconds: s.startSeconds,
      endSeconds: s.endSeconds,
      matchedTrackId: s.matchedTrackId,
      matchStatus: s.matchStatus,
      confidenceScore: s.confidenceScore,
      matchedTempoRatio: s.matchedTempoRatio,
      sourceStartSeconds: s.sourceStartSeconds,
      position: s.position,
      matchedTrack: s.matchedTrackId != null ? (trackById.get(s.matchedTrackId) ?? null) : null,
    })),
  };
}

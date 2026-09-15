import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { desc } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { mixtapes, tracks } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { trackFingerprint } from "@/lib/import/fingerprint";
import { writeSidecars } from "@/lib/import/indexCommon";
import { sanitizeFilename, toDataDirRelative } from "@/lib/import/paths";
import { CorruptFileError, extractTags, type ExtractedTags, UnsupportedFormatError } from "@/lib/import/tags";
import { ensureTrackArtistLink, upsertArtist } from "@/lib/import/upsert";
import { generateWaveform, type WaveformResult } from "@/lib/import/waveform";
import { createAndEnqueueMixtapeJob } from "@/lib/mixtapes/queue";
import { mixtapeDirFor } from "@/lib/mixtapes/paths";

/**
 * POST /api/v1/mixtapes — uploads one DJ mix / mixtape file, extracts tags + a waveform (same
 * read pipeline as track import, lib/import/indexCommon.ts::readTagsAndWaveform), stores it under
 * its own uuid, inserts both a `mixtapes` row (matching/segmentation state — see the comment on
 * that schema for why it's a distinct table) and a companion `tracks` row so the mix itself shows
 * up in the regular library, and auto-starts matching against the local library. Single file per
 * request, unlike bulk track import — a mixtape upload is a one-off, not a folder of hundreds of
 * files.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Could not read the upload." } },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "No file provided under the 'file' field." } },
      { status: 400 }
    );
  }
  const titleOverride = readFormString(formData, "title");

  const uuid = randomUUID();
  const destDir = mixtapeDirFor(uuid);
  mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, sanitizeFilename(file.name));

  await pipeline(Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream<Uint8Array>), createWriteStream(destPath));

  let tags;
  let waveform;
  try {
    tags = await extractTags(destPath, file.name);
    waveform = await generateWaveform(destPath, tags.durationSeconds);
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      return NextResponse.json({ error: { code: "unsupported_format", message: err.message } }, { status: 400 });
    }
    if (err instanceof CorruptFileError) {
      return NextResponse.json({ error: { code: "corrupt_file", message: err.message } }, { status: 400 });
    }
    throw err;
  }

  const { waveformAbsPath, coverArtRelativePath } = writeSidecars(uuid, tags, waveform);
  const relativePath = toDataDirRelative(destPath);
  const relativeWaveformPath = toDataDirRelative(waveformAbsPath);

  const db = getDb();
  const now = new Date().toISOString();

  const mixtape = db.transaction((tx) => {
    const libraryTrack = insertMixtapeLibraryTrack(tx, {
      title: titleOverride ?? tags.title,
      relativePath,
      fileSizeBytes: file.size,
      fileMtimeMs: statSync(destPath).mtimeMs,
      tags,
      waveform,
      relativeWaveformPath,
      coverArtRelativePath,
    });

    return tx
      .insert(mixtapes)
      .values({
        uuid,
        title: titleOverride ?? tags.title,
        originalFilename: file.name,
        path: relativePath,
        fileSizeBytes: file.size,
        durationSeconds: tags.durationSeconds,
        format: tags.format,
        codec: tags.codec,
        bitrate: tags.bitrate,
        sampleRate: tags.sampleRate,
        waveformPath: relativeWaveformPath,
        waveformStatus: "ready",
        waveformPeakCount: waveform.peakCount,
        waveformAvgLevel: waveform.avgLevel,
        analysisStatus: "pending",
        libraryTrackId: libraryTrack.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });

  createAndEnqueueMixtapeJob(mixtape.id, destPath);

  return NextResponse.json(mixtape, { status: 201 });
}

// Accepts both the plain DB handle and a transaction handle, same as lib/import/upsert.ts::Db.
type Tx = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

/**
 * Inserts the companion `tracks` row that makes an uploaded mixtape playable from the regular
 * library (see the schema comment on `mixtapes`) — same shape as a normal import's track row
 * (lib/import/indexCommon.ts::insertTrackRow), minus the importJob/jobFile bookkeeping that
 * doesn't apply here.
 *
 * Deliberately does NOT call enqueueTrackFingerprint: audio-landmarking this row would add a
 * full-length mix into the same corpus that segment matching (lib/mixtapes/segments.ts) searches
 * against, which would let mixtape segments match against *other mixtapes'* library rows instead
 * of the real songs they were mixed from.
 */
function insertMixtapeLibraryTrack(
  tx: Tx,
  params: {
    title: string;
    relativePath: string;
    fileSizeBytes: number;
    fileMtimeMs: number;
    tags: ExtractedTags;
    waveform: WaveformResult;
    relativeWaveformPath: string;
    coverArtRelativePath: string | null;
  }
): typeof tracks.$inferSelect {
  const { tags, waveform } = params;
  const artist = upsertArtist(tx, tags.artist);

  const track = tx
    .insert(tracks)
    .values({
      uuid: randomUUID(),
      path: params.relativePath,
      libraryRootId: null,
      fingerprint: trackFingerprint(params.relativePath, params.fileSizeBytes, params.fileMtimeMs),
      fileMtime: new Date(params.fileMtimeMs).toISOString(),
      fileSizeBytes: params.fileSizeBytes,
      title: params.title,
      artistId: artist.id,
      albumId: null,
      year: tags.year,
      genre: tags.genre,
      durationSeconds: tags.durationSeconds,
      format: tags.format,
      codec: tags.codec,
      bitrate: tags.bitrate,
      sampleRate: tags.sampleRate,
      bitDepth: tags.bitDepth,
      channels: tags.channels,
      lossless: tags.lossless ? 1 : 0,
      coverArtPath: params.coverArtRelativePath,
      waveformPath: params.relativeWaveformPath,
      waveformStatus: "ready",
      waveformPeakCount: waveform.peakCount,
      waveformAvgLevel: waveform.avgLevel,
      rawTagsJson: tags.rawTagsJson,
      importJobId: null,
      dateAdded: new Date().toISOString(),
    })
    .returning()
    .get();

  ensureTrackArtistLink(tx, track.id, artist.id, "primary", 0);
  return track;
}

/** GET /api/v1/mixtapes — list, newest first. Mixtapes are few compared to a library's track
 *  count, so this is a plain unpaginated list rather than the cursor pagination tracks use. */
export async function GET() {
  const items = getDb().select().from(mixtapes).orderBy(desc(mixtapes.createdAt)).all();
  return NextResponse.json({ items });
}

function readFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

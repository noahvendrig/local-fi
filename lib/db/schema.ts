import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Mirrors ARCHITECTURE.md §3. The SQL in that doc is the conceptual shape;
// this Drizzle schema is the actual source of truth migrations compile from.

export const artists = sqliteTable(
  "artists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    name: text("name").notNull(),
    sortName: text("sort_name"),
    fingerprint: text("fingerprint").notNull(),
  },
  (t) => [uniqueIndex("idx_artists_fingerprint").on(t.fingerprint)]
);

export const albums = sqliteTable(
  "albums",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    title: text("title").notNull(),
    albumArtistId: integer("album_artist_id").references(() => artists.id),
    year: integer("year"),
    isCompilation: integer("is_compilation").notNull().default(0),
    coverArtPath: text("cover_art_path"),
    fingerprint: text("fingerprint").notNull(),
    dateAdded: text("date_added").notNull(),
  },
  (t) => [
    uniqueIndex("idx_albums_fingerprint").on(t.fingerprint),
    index("idx_albums_artist").on(t.albumArtistId),
  ]
);

export const albumArtists = sqliteTable(
  "album_artists",
  {
    albumId: integer("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("pk_album_artists").on(t.albumId, t.artistId),
  ]
);

export const trackArtists = sqliteTable(
  "track_artists",
  {
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("primary"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("pk_track_artists").on(t.trackId, t.artistId, t.role),
    check("chk_track_artists_role", sql`${t.role} IN ('primary','featured')`),
  ]
);

/** A folder on disk the user points local-fi at and indexes in place, never copying audio out of it. */
export const libraryRoots = sqliteTable("library_roots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  /** Recognized-audio-file count from the last scan of this root — a cache refreshed on
   *  add/rescan, not a live query, so it can drift from `tracks` until the next scan. */
  totalFileCount: integer("total_file_count").notNull().default(0),
  /** Opt-in at add-time: mirror this root (and each immediate subfolder) into manual crates. */
  syncToCrate: integer("sync_to_crate").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    totalFiles: integer("total_files").notNull().default(0),
    processedFiles: integer("processed_files").notNull().default(0),
    failedFiles: integer("failed_files").notNull().default(0),
    createFolderPlaylists: integer("create_folder_playlists").notNull().default(0),
    /** Opt-in re-encode to Opus during upload (never applied to `folder_scan` jobs — those files are never touched). */
    compressAudio: integer("compress_audio").notNull().default(0),
    /** `spotify_import` only — the crate (created up front, named after the playlist) each successfully-downloaded track gets appended to as it finishes. */
    targetPlaylistId: integer("target_playlist_id").references(() => playlists.id, { onDelete: "set null" }),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("chk_import_jobs_type", sql`${t.type} IN ('upload','scan','folder_scan','spotify_import')`),
    check(
      "chk_import_jobs_status",
      sql`${t.status} IN ('pending','running','completed','completed_with_errors','failed','cancelled')`
    ),
  ]
);

export const importJobFiles = sqliteTable(
  "import_job_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    /** Absolute staged temp path for `upload` jobs; the real in-place file path for `folder_scan` jobs (never moved). */
    stagedPath: text("staged_path"),
    /** Immediate subfolder (of the imported root) this file came from, e.g. "Album A" — null if it sat directly in the imported folder. */
    sourceFolder: text("source_folder"),
    /** Set only for `folder_scan` files — which library root `stagedPath` is relative to. */
    libraryRootId: integer("library_root_id").references(() => libraryRoots.id, { onDelete: "set null" }),
    trackId: integer("track_id").references(() => tracks.id, { onDelete: "set null" }),
    status: text("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    bytesTotal: integer("bytes_total"),
    bytesProcessed: integer("bytes_processed"),
    /** Set only for `spotify_import` files — the source track's {title, artists, album, durationMs, coverArtUrl} as JSON, fetched up front so progress UI has a name to show before a YouTube match is even found. */
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_import_job_files_job").on(t.jobId),
    check(
      "chk_import_job_files_status",
      sql`${t.status} IN ('queued','matching','downloading','reading_tags','transcoding_waveform','saving','done','failed','duplicate_skipped')`
    ),
  ]
);

export const tracks = sqliteTable(
  "tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    /** Relative to LOCALFI_DATA_DIR/originals when libraryRootId is null (managed); relative to that root's path otherwise (watched). */
    path: text("path").notNull(),
    /** NULL = managed (copy-on-import, lives under data/originals/). Non-null = watched in place under that library_roots row. */
    libraryRootId: integer("library_root_id").references(() => libraryRoots.id, { onDelete: "set null" }),
    fingerprint: text("fingerprint").notNull(),
    fileMtime: text("file_mtime").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),

    title: text("title"),
    artistId: integer("artist_id").references(() => artists.id),
    albumId: integer("album_id").references(() => albums.id),
    trackNumber: integer("track_number"),
    trackTotal: integer("track_total"),
    discNumber: integer("disc_number"),
    discTotal: integer("disc_total"),
    year: integer("year"),
    genre: text("genre"),

    durationSeconds: real("duration_seconds").notNull(),
    format: text("format").notNull(),
    codec: text("codec"),
    bitrate: integer("bitrate"),
    sampleRate: integer("sample_rate"),
    bitDepth: integer("bit_depth"),
    channels: integer("channels"),
    lossless: integer("lossless").notNull().default(0),

    coverArtPath: text("cover_art_path"),
    waveformPath: text("waveform_path"),
    waveformStatus: text("waveform_status").notNull().default("pending"),
    waveformPeakCount: integer("waveform_peak_count"),
    waveformAvgLevel: real("waveform_avg_level"),

    playCount: integer("play_count").notNull().default(0),
    lastPlayedAt: text("last_played_at"),

    rawTagsJson: text("raw_tags_json"),

    bpm: real("bpm"),
    bpmSource: text("bpm_source"),
    key: text("key"),
    keySource: text("key_source"),
    analysisStatus: text("analysis_status").notNull().default("none"),
    analysisError: text("analysis_error"),
    analyzedAt: text("analyzed_at"),

    /** Beat-grid sidecar for AI DJ beatmatching (lib/analysis/beatGrid.ts) — same scalar-status/disk-blob
     *  split as waveformPath/waveformStatus above. The blob is a small JSON array of beat timestamps
     *  (seconds) from music-tempo's Beatroot output, computed alongside bpm/key detection. */
    beatGridStatus: text("beat_grid_status").notNull().default("none"),
    beatGridPath: text("beat_grid_path"),

    /** Audio-content fingerprint status for mixtape matching (lib/fingerprint/*) — unrelated to
     *  the `fingerprint` column above, which is only a dedup hash of path+size+mtime. The actual
     *  landmark/hash data never lives here; it's kept entirely inside python-backend's own
     *  storage (a per-track sidecar file plus its in-memory inverted index), the same split
     *  waveformPath/waveformStatus make between a scalar status here and the peak blob on disk. */
    landmarkStatus: text("landmark_status").notNull().default("none"),
    landmarkCount: integer("landmark_count"),
    landmarkedAt: text("landmarked_at"),

    /** Audio-similarity embedding status for Smart Shuffle (services/similarity/) — same split as
     *  landmarkStatus above: the embedding vector and k-NN graph never live here, only in
     *  python-backend's own sidecar files + in-memory index. */
    similarityStatus: text("similarity_status").notNull().default("none"),
    similarityAnalyzedAt: text("similarity_analyzed_at"),

    importJobId: integer("import_job_id").references(() => importJobs.id, { onDelete: "set null" }),
    dateAdded: text("date_added").notNull(),
    dateModified: text("date_modified"),
    missingSince: text("missing_since"),
    deletedAt: text("deleted_at"),

    /** Provenance for tracks fetched from an external source rather than imported from a local file (e.g. 'spotify' for the Spotify/yt-dlp import flow) — null for ordinary file imports. */
    sourceProvider: text("source_provider"),
    sourceUrl: text("source_url"),
  },
  (t) => [
    uniqueIndex("idx_tracks_uuid").on(t.uuid),
    // Scoped per root (not a single global unique(path)) so two watched roots — or a
    // watched root and the managed originals/ tree — can't collide on relative path,
    // while still making a rescan of the same root idempotent (ARCHITECTURE.md §2/§3.6).
    uniqueIndex("idx_tracks_path_root").on(t.path, t.libraryRootId),
    // Backs up the check-then-insert dedup in spotifyPipeline.ts against concurrent
    // import workers racing on the same Spotify track (both pass the SELECT check
    // before either finishes its YouTube match+download, so both insert). Partial
    // index since sourceUrl is null for ordinary file imports.
    uniqueIndex("idx_tracks_source")
      .on(t.sourceProvider, t.sourceUrl)
      .where(sql`${t.sourceUrl} IS NOT NULL`),
    index("idx_tracks_library_root").on(t.libraryRootId),
    index("idx_tracks_fingerprint").on(t.fingerprint),
    index("idx_tracks_album").on(t.albumId, t.discNumber, t.trackNumber),
    index("idx_tracks_artist").on(t.artistId),
    index("idx_tracks_missing").on(t.missingSince),
    index("idx_tracks_deleted").on(t.deletedAt),
    index("idx_tracks_lossless").on(t.lossless),
    index("idx_tracks_date_added").on(t.dateAdded),
    check(
      "chk_tracks_format",
      sql`${t.format} IN ('mp3','flac','wav','aac','m4a','ogg','alac','aiff','webm')`
    ),
    check(
      "chk_tracks_waveform_status",
      sql`${t.waveformStatus} IN ('pending','processing','ready','failed')`
    ),
    check("chk_tracks_bpm_source", sql`${t.bpmSource} IS NULL OR ${t.bpmSource} IN ('tag','detected','manual')`),
    check("chk_tracks_key_source", sql`${t.keySource} IS NULL OR ${t.keySource} IN ('tag','detected','manual')`),
    check(
      "chk_tracks_analysis_status",
      sql`${t.analysisStatus} IN ('none','queued','analyzing','ready','failed')`
    ),
    check("chk_tracks_beat_grid_status", sql`${t.beatGridStatus} IN ('none','ready','failed')`),
    check(
      "chk_tracks_landmark_status",
      sql`${t.landmarkStatus} IN ('none','queued','processing','ready','failed')`
    ),
    check(
      "chk_tracks_similarity_status",
      sql`${t.similarityStatus} IN ('none','queued','processing','ready','failed')`
    ),
  ]
);

// On-demand BPM/key detection (DJ view §Phase 3) — separate job system from importJobs since
// analysis never runs as part of a regular import; it's only triggered from the DJ view.
export const analysisJobs = sqliteTable(
  "analysis_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    status: text("status").notNull().default("pending"),
    totalTracks: integer("total_tracks").notNull().default(0),
    processedTracks: integer("processed_tracks").notNull().default(0),
    failedTracks: integer("failed_tracks").notNull().default(0),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check(
      "chk_analysis_jobs_status",
      sql`${t.status} IN ('pending','running','completed','completed_with_errors','failed','cancelled')`
    ),
  ]
);

export const analysisJobTracks = sqliteTable(
  "analysis_job_tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_analysis_job_tracks_job").on(t.jobId),
    check(
      "chk_analysis_job_tracks_status",
      sql`${t.status} IN ('queued','analyzing','done','failed')`
    ),
  ]
);

// Audio-fingerprint backfill/on-import job (mixtape-segmentation plan) — a separate job system
// from analysisJobs (same shape, different table) because fingerprinting *does* run automatically
// on import (see the comment on analysisJobs above for why BPM/key detection deliberately
// doesn't), and because the actual DSP work happens on python-backend, not in this process — this
// table's `pythonJobId` just tracks which job on that service a row corresponds to.
export const fingerprintJobs = sqliteTable(
  "fingerprint_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    /** The corresponding job id on python-backend's own in-memory job manager. */
    pythonJobId: text("python_job_id"),
    status: text("status").notNull().default("pending"),
    totalTracks: integer("total_tracks").notNull().default(0),
    processedTracks: integer("processed_tracks").notNull().default(0),
    failedTracks: integer("failed_tracks").notNull().default(0),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check(
      "chk_fingerprint_jobs_status",
      sql`${t.status} IN ('pending','running','completed','completed_with_errors','failed','cancelled')`
    ),
  ]
);

export const fingerprintJobTracks = sqliteTable(
  "fingerprint_job_tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => fingerprintJobs.id, { onDelete: "cascade" }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_fingerprint_job_tracks_job").on(t.jobId),
    check(
      "chk_fingerprint_job_tracks_status",
      sql`${t.status} IN ('queued','processing','done','failed')`
    ),
  ]
);

// Audio-similarity embedding backfill/on-import job for Smart Shuffle (services/similarity/) —
// same shape/rationale as fingerprintJobs above (a separate table from analysisJobs because this
// *does* run automatically on import, and the DSP work happens on python-backend, not here).
export const similarityJobs = sqliteTable(
  "similarity_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    /** The corresponding job id on python-backend's own in-memory job manager. */
    pythonJobId: text("python_job_id"),
    status: text("status").notNull().default("pending"),
    totalTracks: integer("total_tracks").notNull().default(0),
    processedTracks: integer("processed_tracks").notNull().default(0),
    failedTracks: integer("failed_tracks").notNull().default(0),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check(
      "chk_similarity_jobs_status",
      sql`${t.status} IN ('pending','running','completed','completed_with_errors','failed','cancelled')`
    ),
  ]
);

export const similarityJobTracks = sqliteTable(
  "similarity_job_tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => similarityJobs.id, { onDelete: "cascade" }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_similarity_job_tracks_job").on(t.jobId),
    check(
      "chk_similarity_job_tracks_status",
      sql`${t.status} IN ('queued','processing','done','failed')`
    ),
  ]
);

/**
 * An uploaded DJ mix / mixtape awaiting (or already given) per-song segmentation against the
 * local library. Deliberately not *itself modeled as* a row in `tracks` — a mixtape's identity
 * (jobs, segments, matching state) lives entirely here. It does, however, get a companion `tracks`
 * row (`libraryTrackId`) created alongside it at upload time so the full mix is playable from the
 * regular library like any other track; that companion row is never audio-fingerprinted (see the
 * comment on `insertMixtapeLibraryTrack` in app/api/v1/mixtapes/route.ts) so it can't pollute the
 * landmark corpus that segment matching searches. The two rows share one physical audio file —
 * deleting either one must delete both (see the DELETE handlers on this route and on
 * app/api/v1/tracks/[id]/route.ts).
 */
export const mixtapes = sqliteTable(
  "mixtapes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    title: text("title").notNull(),
    originalFilename: text("original_filename").notNull(),
    /** Relative to LOCALFI_DATA_DIR/mixtapes/. */
    path: text("path").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    durationSeconds: real("duration_seconds").notNull(),
    format: text("format").notNull(),
    codec: text("codec"),
    bitrate: integer("bitrate"),
    sampleRate: integer("sample_rate"),

    waveformPath: text("waveform_path"),
    waveformStatus: text("waveform_status").notNull().default("pending"),
    waveformPeakCount: integer("waveform_peak_count"),
    waveformAvgLevel: real("waveform_avg_level"),

    analysisStatus: text("analysis_status").notNull().default("pending"),
    latestJobId: integer("latest_job_id"),

    /** The `tracks` row created alongside this mixtape so it shows up in the regular library —
     *  see the table comment above. Null only for rows written before this existed. */
    libraryTrackId: integer("library_track_id").references(() => tracks.id, { onDelete: "set null" }),

    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "chk_mixtapes_waveform_status",
      sql`${t.waveformStatus} IN ('pending','processing','ready','failed')`
    ),
    check(
      "chk_mixtapes_analysis_status",
      sql`${t.analysisStatus} IN ('pending','queued','analyzing','ready','failed')`
    ),
  ]
);

// One long-running task with sequential stages, not many independent items -- unlike
// import/analysis/fingerprint jobs (N items, item-level progress rows), so this carries
// `stage`/`progressPct` instead of a totalTracks/processedTracks/failedTracks triple.
export const mixtapeJobs = sqliteTable(
  "mixtape_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    mixtapeId: integer("mixtape_id")
      .notNull()
      .references(() => mixtapes.id, { onDelete: "cascade" }),
    /** The corresponding job id on python-backend's own in-memory job manager. */
    pythonJobId: text("python_job_id"),
    status: text("status").notNull().default("pending"),
    stage: text("stage"),
    progressPct: real("progress_pct").notNull().default(0),
    matchedSegments: integer("matched_segments").notNull().default(0),
    unrecognizedSegments: integer("unrecognized_segments").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_mixtape_jobs_mixtape").on(t.mixtapeId),
    check(
      "chk_mixtape_jobs_status",
      sql`${t.status} IN ('pending','running','completed','completed_with_errors','failed','cancelled')`
    ),
    check(
      "chk_mixtape_jobs_stage",
      sql`${t.stage} IS NULL OR ${t.stage} IN ('decoding','fingerprinting','matching','done')`
    ),
  ]
);

export const mixtapeSegments = sqliteTable(
  "mixtape_segments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mixtapeId: integer("mixtape_id")
      .notNull()
      .references(() => mixtapes.id, { onDelete: "cascade" }),
    startSeconds: real("start_seconds").notNull(),
    endSeconds: real("end_seconds").notNull(),
    /** Null = unrecognized. */
    matchedTrackId: integer("matched_track_id").references(() => tracks.id, { onDelete: "set null" }),
    matchStatus: text("match_status").notNull().default("unrecognized"),
    /** 0..1, null until a match exists. */
    confidenceScore: real("confidence_score"),
    /** Detected playback-speed ratio vs. the matched track's native speed (e.g. a DJ pitch-faded
     *  transition), null until a match exists. */
    matchedTempoRatio: real("matched_tempo_ratio"),
    /** Where in the *matched track's own* timeline this segment starts, null until a match exists. */
    sourceStartSeconds: real("source_start_seconds"),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_mixtape_segments_mixtape").on(t.mixtapeId, t.position),
    check(
      "chk_mixtape_segments_match_status",
      sql`${t.matchStatus} IN ('auto_matched','manual','unrecognized','rejected')`
    ),
  ]
);

export const playlists = sqliteTable(
  "playlists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    rulesJson: text("rules_json"),
    sortField: text("sort_field"),
    coverArtPath: text("cover_art_path"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("chk_playlists_type", sql`${t.type} IN ('manual','smart')`)]
);

export const playlistTracks = sqliteTable(
  "playlist_tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    position: text("position").notNull(),
    addedAt: text("added_at").notNull(),
  },
  (t) => [index("idx_playlist_tracks_order").on(t.playlistId, t.position)]
);

/**
 * Links a "sync to playlist" library root to the manual crate(s) that mirror it — one row
 * for the whole-root crate (`subfolderPath` = "") and one per immediate subfolder crate
 * discovered so far. Membership within each crate is maintained by lib/library/syncCrates.ts
 * as files are indexed; deleting the crate here is a plain playlist delete (cascades normally).
 */
export const libraryRootCrates = sqliteTable(
  "library_root_crates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    libraryRootId: integer("library_root_id")
      .notNull()
      .references(() => libraryRoots.id, { onDelete: "cascade" }),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    subfolderPath: text("subfolder_path").notNull().default(""),
  },
  (t) => [uniqueIndex("idx_library_root_crates_scope").on(t.libraryRootId, t.subfolderPath)]
);

export const playEvents = sqliteTable(
  "play_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    playedAt: text("played_at").notNull(),
  },
  (t) => [
    index("idx_play_events_track").on(t.trackId),
    index("idx_play_events_played_at").on(t.playedAt),
  ]
);

export const playbackState = sqliteTable("playback_state", {
  sessionKey: text("session_key").primaryKey().default("default"),
  queueJson: text("queue_json").notNull(),
  currentIndex: integer("current_index").notNull().default(0),
  positionSeconds: real("position_seconds").notNull().default(0),
  isPlaying: integer("is_playing").notNull().default(0),
  volume: real("volume").notNull().default(1.0),
  repeatMode: text("repeat_mode").notNull().default("off"),
  shuffleMode: text("shuffle_mode").notNull().default("off"),
  eqJson: text("eq_json"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  check("chk_playback_state_repeat_mode", sql`${t.repeatMode} IN ('off','all','one')`),
  check("chk_playback_state_shuffle_mode", sql`${t.shuffleMode} IN ('off','random','smart')`),
]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A phone (or other second client) paired over LAN via a QR/code scan (mobile plan Phase B).
 * `token` is a long-lived bearer credential checked as a fallback in lib/auth/verifyToken.ts
 * after the single static token — additive, not a replacement, so desktop's existing auth path
 * is untouched. Revoking is soft (revokedAt set, row kept) so the paired-devices list can still
 * show a device's history after it's removed.
 */
export const devices = sqliteTable("devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique(),
  token: text("token").notNull().unique(),
  name: text("name").notNull(),
  pairedAt: text("paired_at").notNull(),
  lastSeenAt: text("last_seen_at"),
  revokedAt: text("revoked_at"),
});

/**
 * A short-lived pairing code shown as a QR (and its plain-text form) on the PC. Deliberately a
 * separate table from `devices`, not a status column on it — a session is single-use/short-TTL
 * (mints at most one device row) while a device is long-lived, mirroring the existing
 * import_jobs-produces-a-result shape rather than overloading one row's lifecycle for both.
 */
export const pairingSessions = sqliteTable("pairing_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  deviceId: integer("device_id").references(() => devices.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
});

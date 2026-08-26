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
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("chk_import_jobs_type", sql`${t.type} IN ('upload','scan','folder_scan')`),
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
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_import_job_files_job").on(t.jobId),
    check(
      "chk_import_job_files_status",
      sql`${t.status} IN ('queued','reading_tags','transcoding_waveform','saving','done','failed','duplicate_skipped')`
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

    importJobId: integer("import_job_id").references(() => importJobs.id, { onDelete: "set null" }),
    dateAdded: text("date_added").notNull(),
    dateModified: text("date_modified"),
    missingSince: text("missing_since"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("idx_tracks_uuid").on(t.uuid),
    // Scoped per root (not a single global unique(path)) so two watched roots — or a
    // watched root and the managed originals/ tree — can't collide on relative path,
    // while still making a rescan of the same root idempotent (ARCHITECTURE.md §2/§3.6).
    uniqueIndex("idx_tracks_path_root").on(t.path, t.libraryRootId),
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
  shuffle: integer("shuffle").notNull().default(0),
  eqJson: text("eq_json"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  check("chk_playback_state_repeat_mode", sql`${t.repeatMode} IN ('off','all','one')`),
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

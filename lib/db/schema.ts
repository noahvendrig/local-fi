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
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("chk_import_jobs_type", sql`${t.type} IN ('upload','scan')`),
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
    stagedPath: text("staged_path"),
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
    path: text("path").notNull().unique(),
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

    importJobId: integer("import_job_id").references(() => importJobs.id, { onDelete: "set null" }),
    dateAdded: text("date_added").notNull(),
    dateModified: text("date_modified"),
    missingSince: text("missing_since"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("idx_tracks_uuid").on(t.uuid),
    index("idx_tracks_fingerprint").on(t.fingerprint),
    index("idx_tracks_album").on(t.albumId, t.discNumber, t.trackNumber),
    index("idx_tracks_artist").on(t.artistId),
    index("idx_tracks_missing").on(t.missingSince),
    index("idx_tracks_deleted").on(t.deletedAt),
    index("idx_tracks_lossless").on(t.lossless),
    index("idx_tracks_date_added").on(t.dateAdded),
    check(
      "chk_tracks_format",
      sql`${t.format} IN ('mp3','flac','wav','aac','m4a','ogg','alac','aiff')`
    ),
    check(
      "chk_tracks_waveform_status",
      sql`${t.waveformStatus} IN ('pending','processing','ready','failed')`
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

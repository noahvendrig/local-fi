CREATE TABLE `fingerprint_job_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`track_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `fingerprint_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_fingerprint_job_tracks_status" CHECK("fingerprint_job_tracks"."status" IN ('queued','processing','done','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_fingerprint_job_tracks_job` ON `fingerprint_job_tracks` (`job_id`);--> statement-breakpoint
CREATE TABLE `fingerprint_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`python_job_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_tracks` integer DEFAULT 0 NOT NULL,
	`processed_tracks` integer DEFAULT 0 NOT NULL,
	`failed_tracks` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "chk_fingerprint_jobs_status" CHECK("fingerprint_jobs"."status" IN ('pending','running','completed','completed_with_errors','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fingerprint_jobs_uuid_unique` ON `fingerprint_jobs` (`uuid`);--> statement-breakpoint
CREATE TABLE `mixtape_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`mixtape_id` integer NOT NULL,
	`python_job_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`stage` text,
	`progress_pct` real DEFAULT 0 NOT NULL,
	`matched_segments` integer DEFAULT 0 NOT NULL,
	`unrecognized_segments` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mixtape_id`) REFERENCES `mixtapes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_mixtape_jobs_status" CHECK("mixtape_jobs"."status" IN ('pending','running','completed','completed_with_errors','failed','cancelled')),
	CONSTRAINT "chk_mixtape_jobs_stage" CHECK("mixtape_jobs"."stage" IS NULL OR "mixtape_jobs"."stage" IN ('decoding','fingerprinting','matching','done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mixtape_jobs_uuid_unique` ON `mixtape_jobs` (`uuid`);--> statement-breakpoint
CREATE INDEX `idx_mixtape_jobs_mixtape` ON `mixtape_jobs` (`mixtape_id`);--> statement-breakpoint
CREATE TABLE `mixtape_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mixtape_id` integer NOT NULL,
	`start_seconds` real NOT NULL,
	`end_seconds` real NOT NULL,
	`matched_track_id` integer,
	`match_status` text DEFAULT 'unrecognized' NOT NULL,
	`confidence_score` real,
	`matched_tempo_ratio` real,
	`source_start_seconds` real,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`mixtape_id`) REFERENCES `mixtapes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_mixtape_segments_match_status" CHECK("mixtape_segments"."match_status" IN ('auto_matched','manual','unrecognized','rejected'))
);
--> statement-breakpoint
CREATE INDEX `idx_mixtape_segments_mixtape` ON `mixtape_segments` (`mixtape_id`,`position`);--> statement-breakpoint
CREATE TABLE `mixtapes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`title` text NOT NULL,
	`original_filename` text NOT NULL,
	`path` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`duration_seconds` real NOT NULL,
	`format` text NOT NULL,
	`codec` text,
	`bitrate` integer,
	`sample_rate` integer,
	`waveform_path` text,
	`waveform_status` text DEFAULT 'pending' NOT NULL,
	`waveform_peak_count` integer,
	`waveform_avg_level` real,
	`analysis_status` text DEFAULT 'pending' NOT NULL,
	`latest_job_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "chk_mixtapes_waveform_status" CHECK("mixtapes"."waveform_status" IN ('pending','processing','ready','failed')),
	CONSTRAINT "chk_mixtapes_analysis_status" CHECK("mixtapes"."analysis_status" IN ('pending','queued','analyzing','ready','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mixtapes_uuid_unique` ON `mixtapes` (`uuid`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`path` text NOT NULL,
	`library_root_id` integer,
	`fingerprint` text NOT NULL,
	`file_mtime` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`title` text,
	`artist_id` integer,
	`album_id` integer,
	`track_number` integer,
	`track_total` integer,
	`disc_number` integer,
	`disc_total` integer,
	`year` integer,
	`genre` text,
	`duration_seconds` real NOT NULL,
	`format` text NOT NULL,
	`codec` text,
	`bitrate` integer,
	`sample_rate` integer,
	`bit_depth` integer,
	`channels` integer,
	`lossless` integer DEFAULT 0 NOT NULL,
	`cover_art_path` text,
	`waveform_path` text,
	`waveform_status` text DEFAULT 'pending' NOT NULL,
	`waveform_peak_count` integer,
	`waveform_avg_level` real,
	`play_count` integer DEFAULT 0 NOT NULL,
	`last_played_at` text,
	`raw_tags_json` text,
	`bpm` real,
	`bpm_source` text,
	`key` text,
	`key_source` text,
	`analysis_status` text DEFAULT 'none' NOT NULL,
	`analysis_error` text,
	`analyzed_at` text,
	`landmark_status` text DEFAULT 'none' NOT NULL,
	`landmark_count` integer,
	`landmarked_at` text,
	`import_job_id` integer,
	`date_added` text NOT NULL,
	`date_modified` text,
	`missing_since` text,
	`deleted_at` text,
	`source_provider` text,
	`source_url` text,
	FOREIGN KEY (`library_root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_tracks_format" CHECK("__new_tracks"."format" IN ('mp3','flac','wav','aac','m4a','ogg','alac','aiff','webm')),
	CONSTRAINT "chk_tracks_waveform_status" CHECK("__new_tracks"."waveform_status" IN ('pending','processing','ready','failed')),
	CONSTRAINT "chk_tracks_bpm_source" CHECK("__new_tracks"."bpm_source" IS NULL OR "__new_tracks"."bpm_source" IN ('tag','detected','manual')),
	CONSTRAINT "chk_tracks_key_source" CHECK("__new_tracks"."key_source" IS NULL OR "__new_tracks"."key_source" IN ('tag','detected','manual')),
	CONSTRAINT "chk_tracks_analysis_status" CHECK("__new_tracks"."analysis_status" IN ('none','queued','analyzing','ready','failed')),
	CONSTRAINT "chk_tracks_landmark_status" CHECK("__new_tracks"."landmark_status" IN ('none','queued','processing','ready','failed'))
);
--> statement-breakpoint
INSERT INTO `__new_tracks`("id", "uuid", "path", "library_root_id", "fingerprint", "file_mtime", "file_size_bytes", "title", "artist_id", "album_id", "track_number", "track_total", "disc_number", "disc_total", "year", "genre", "duration_seconds", "format", "codec", "bitrate", "sample_rate", "bit_depth", "channels", "lossless", "cover_art_path", "waveform_path", "waveform_status", "waveform_peak_count", "waveform_avg_level", "play_count", "last_played_at", "raw_tags_json", "bpm", "bpm_source", "key", "key_source", "analysis_status", "analysis_error", "analyzed_at", "landmark_status", "landmark_count", "landmarked_at", "import_job_id", "date_added", "date_modified", "missing_since", "deleted_at", "source_provider", "source_url") SELECT "id", "uuid", "path", "library_root_id", "fingerprint", "file_mtime", "file_size_bytes", "title", "artist_id", "album_id", "track_number", "track_total", "disc_number", "disc_total", "year", "genre", "duration_seconds", "format", "codec", "bitrate", "sample_rate", "bit_depth", "channels", "lossless", "cover_art_path", "waveform_path", "waveform_status", "waveform_peak_count", "waveform_avg_level", "play_count", "last_played_at", "raw_tags_json", "bpm", "bpm_source", "key", "key_source", "analysis_status", "analysis_error", "analyzed_at", 'none', NULL, NULL, "import_job_id", "date_added", "date_modified", "missing_since", "deleted_at", "source_provider", "source_url" FROM `tracks`;--> statement-breakpoint
DROP TABLE `tracks`;--> statement-breakpoint
ALTER TABLE `__new_tracks` RENAME TO `tracks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_uuid_unique` ON `tracks` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tracks_uuid` ON `tracks` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tracks_path_root` ON `tracks` (`path`,`library_root_id`);--> statement-breakpoint
CREATE INDEX `idx_tracks_library_root` ON `tracks` (`library_root_id`);--> statement-breakpoint
CREATE INDEX `idx_tracks_fingerprint` ON `tracks` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_tracks_album` ON `tracks` (`album_id`,`disc_number`,`track_number`);--> statement-breakpoint
CREATE INDEX `idx_tracks_artist` ON `tracks` (`artist_id`);--> statement-breakpoint
CREATE INDEX `idx_tracks_missing` ON `tracks` (`missing_since`);--> statement-breakpoint
CREATE INDEX `idx_tracks_deleted` ON `tracks` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_tracks_lossless` ON `tracks` (`lossless`);--> statement-breakpoint
CREATE INDEX `idx_tracks_date_added` ON `tracks` (`date_added`);
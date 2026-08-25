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
	`import_job_id` integer,
	`date_added` text NOT NULL,
	`date_modified` text,
	`missing_since` text,
	`deleted_at` text,
	FOREIGN KEY (`library_root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_tracks_format" CHECK("__new_tracks"."format" IN ('mp3','flac','wav','aac','m4a','ogg','alac','aiff','webm')),
	CONSTRAINT "chk_tracks_waveform_status" CHECK("__new_tracks"."waveform_status" IN ('pending','processing','ready','failed'))
);
--> statement-breakpoint
INSERT INTO `__new_tracks`("id", "uuid", "path", "library_root_id", "fingerprint", "file_mtime", "file_size_bytes", "title", "artist_id", "album_id", "track_number", "track_total", "disc_number", "disc_total", "year", "genre", "duration_seconds", "format", "codec", "bitrate", "sample_rate", "bit_depth", "channels", "lossless", "cover_art_path", "waveform_path", "waveform_status", "waveform_peak_count", "waveform_avg_level", "play_count", "last_played_at", "raw_tags_json", "import_job_id", "date_added", "date_modified", "missing_since", "deleted_at") SELECT "id", "uuid", "path", "library_root_id", "fingerprint", "file_mtime", "file_size_bytes", "title", "artist_id", "album_id", "track_number", "track_total", "disc_number", "disc_total", "year", "genre", "duration_seconds", "format", "codec", "bitrate", "sample_rate", "bit_depth", "channels", "lossless", "cover_art_path", "waveform_path", "waveform_status", "waveform_peak_count", "waveform_avg_level", "play_count", "last_played_at", "raw_tags_json", "import_job_id", "date_added", "date_modified", "missing_since", "deleted_at" FROM `tracks`;--> statement-breakpoint
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
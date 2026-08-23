CREATE TABLE `album_artists` (
	`album_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pk_album_artists` ON `album_artists` (`album_id`,`artist_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`title` text NOT NULL,
	`album_artist_id` integer,
	`year` integer,
	`is_compilation` integer DEFAULT 0 NOT NULL,
	`cover_art_path` text,
	`fingerprint` text NOT NULL,
	`date_added` text NOT NULL,
	FOREIGN KEY (`album_artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_uuid_unique` ON `albums` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_albums_fingerprint` ON `albums` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_albums_artist` ON `albums` (`album_artist_id`);--> statement-breakpoint
CREATE TABLE `artists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`sort_name` text,
	`fingerprint` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artists_uuid_unique` ON `artists` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artists_fingerprint` ON `artists` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `import_job_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`original_filename` text NOT NULL,
	`staged_path` text,
	`track_id` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_message` text,
	`bytes_total` integer,
	`bytes_processed` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_import_job_files_status" CHECK("import_job_files"."status" IN ('queued','reading_tags','transcoding_waveform','saving','done','failed','duplicate_skipped'))
);
--> statement-breakpoint
CREATE INDEX `idx_import_job_files_job` ON `import_job_files` (`job_id`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_files` integer DEFAULT 0 NOT NULL,
	`processed_files` integer DEFAULT 0 NOT NULL,
	`failed_files` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "chk_import_jobs_type" CHECK("import_jobs"."type" IN ('upload','scan')),
	CONSTRAINT "chk_import_jobs_status" CHECK("import_jobs"."status" IN ('pending','running','completed','completed_with_errors','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_jobs_uuid_unique` ON `import_jobs` (`uuid`);--> statement-breakpoint
CREATE TABLE `playback_state` (
	`session_key` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`queue_json` text NOT NULL,
	`current_index` integer DEFAULT 0 NOT NULL,
	`position_seconds` real DEFAULT 0 NOT NULL,
	`is_playing` integer DEFAULT 0 NOT NULL,
	`volume` real DEFAULT 1 NOT NULL,
	`repeat_mode` text DEFAULT 'off' NOT NULL,
	`shuffle` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "chk_playback_state_repeat_mode" CHECK("playback_state"."repeat_mode" IN ('off','all','one'))
);
--> statement-breakpoint
CREATE TABLE `playlist_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`track_id` integer NOT NULL,
	`position` text NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_playlist_tracks_order` ON `playlist_tracks` (`playlist_id`,`position`);--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`rules_json` text,
	`sort_field` text,
	`cover_art_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "chk_playlists_type" CHECK("playlists"."type" IN ('manual','smart'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlists_uuid_unique` ON `playlists` (`uuid`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `track_artists` (
	`track_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`role` text DEFAULT 'primary' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_track_artists_role" CHECK("track_artists"."role" IN ('primary','featured'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pk_track_artists` ON `track_artists` (`track_id`,`artist_id`,`role`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`path` text NOT NULL,
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
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_tracks_format" CHECK("tracks"."format" IN ('mp3','flac','wav','aac','m4a','ogg','alac','aiff')),
	CONSTRAINT "chk_tracks_waveform_status" CHECK("tracks"."waveform_status" IN ('pending','processing','ready','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_uuid_unique` ON `tracks` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `tracks_path_unique` ON `tracks` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tracks_uuid` ON `tracks` (`uuid`);--> statement-breakpoint
CREATE INDEX `idx_tracks_fingerprint` ON `tracks` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_tracks_album` ON `tracks` (`album_id`,`disc_number`,`track_number`);--> statement-breakpoint
CREATE INDEX `idx_tracks_artist` ON `tracks` (`artist_id`);--> statement-breakpoint
CREATE INDEX `idx_tracks_missing` ON `tracks` (`missing_since`);--> statement-breakpoint
CREATE INDEX `idx_tracks_deleted` ON `tracks` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_tracks_lossless` ON `tracks` (`lossless`);--> statement-breakpoint
CREATE INDEX `idx_tracks_date_added` ON `tracks` (`date_added`);
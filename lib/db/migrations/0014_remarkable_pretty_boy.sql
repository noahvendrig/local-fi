PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mixtapes` (
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
	`library_track_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`library_track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_mixtapes_waveform_status" CHECK("__new_mixtapes"."waveform_status" IN ('pending','processing','ready','failed')),
	CONSTRAINT "chk_mixtapes_analysis_status" CHECK("__new_mixtapes"."analysis_status" IN ('pending','queued','analyzing','ready','failed'))
);
--> statement-breakpoint
INSERT INTO `__new_mixtapes`("id", "uuid", "title", "original_filename", "path", "file_size_bytes", "duration_seconds", "format", "codec", "bitrate", "sample_rate", "waveform_path", "waveform_status", "waveform_peak_count", "waveform_avg_level", "analysis_status", "latest_job_id", "library_track_id", "created_at", "updated_at") SELECT "id", "uuid", "title", "original_filename", "path", "file_size_bytes", "duration_seconds", "format", "codec", "bitrate", "sample_rate", "waveform_path", "waveform_status", "waveform_peak_count", "waveform_avg_level", "analysis_status", "latest_job_id", NULL, "created_at", "updated_at" FROM `mixtapes`;--> statement-breakpoint
DROP TABLE `mixtapes`;--> statement-breakpoint
ALTER TABLE `__new_mixtapes` RENAME TO `mixtapes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mixtapes_uuid_unique` ON `mixtapes` (`uuid`);

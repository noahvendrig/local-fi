CREATE TABLE `spotify_enrich_job_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`track_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `spotify_enrich_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_spotify_enrich_job_tracks_status" CHECK("spotify_enrich_job_tracks"."status" IN ('queued','matching','matched','no_match','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_spotify_enrich_job_tracks_job` ON `spotify_enrich_job_tracks` (`job_id`);--> statement-breakpoint
CREATE TABLE `spotify_enrich_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_tracks` integer DEFAULT 0 NOT NULL,
	`processed_tracks` integer DEFAULT 0 NOT NULL,
	`matched_tracks` integer DEFAULT 0 NOT NULL,
	`failed_tracks` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "chk_spotify_enrich_jobs_status" CHECK("spotify_enrich_jobs"."status" IN ('pending','running','completed','completed_with_errors','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spotify_enrich_jobs_uuid_unique` ON `spotify_enrich_jobs` (`uuid`);
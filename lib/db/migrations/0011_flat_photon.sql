PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_import_job_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`original_filename` text NOT NULL,
	`staged_path` text,
	`source_folder` text,
	`library_root_id` integer,
	`track_id` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_message` text,
	`bytes_total` integer,
	`bytes_processed` integer,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_import_job_files_status" CHECK("__new_import_job_files"."status" IN ('queued','matching','downloading','reading_tags','transcoding_waveform','saving','done','failed','duplicate_skipped'))
);
--> statement-breakpoint
INSERT INTO `__new_import_job_files`("id", "job_id", "original_filename", "staged_path", "source_folder", "library_root_id", "track_id", "status", "error_message", "bytes_total", "bytes_processed", "metadata_json", "created_at", "updated_at") SELECT "id", "job_id", "original_filename", "staged_path", "source_folder", "library_root_id", "track_id", "status", "error_message", "bytes_total", "bytes_processed", NULL, "created_at", "updated_at" FROM `import_job_files`;--> statement-breakpoint
DROP TABLE `import_job_files`;--> statement-breakpoint
ALTER TABLE `__new_import_job_files` RENAME TO `import_job_files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_import_job_files_job` ON `import_job_files` (`job_id`);--> statement-breakpoint
CREATE TABLE `__new_import_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_files` integer DEFAULT 0 NOT NULL,
	`processed_files` integer DEFAULT 0 NOT NULL,
	`failed_files` integer DEFAULT 0 NOT NULL,
	`create_folder_playlists` integer DEFAULT 0 NOT NULL,
	`compress_audio` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "chk_import_jobs_type" CHECK("__new_import_jobs"."type" IN ('upload','scan','folder_scan','spotify_import')),
	CONSTRAINT "chk_import_jobs_status" CHECK("__new_import_jobs"."status" IN ('pending','running','completed','completed_with_errors','failed','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_import_jobs`("id", "uuid", "type", "status", "total_files", "processed_files", "failed_files", "create_folder_playlists", "compress_audio", "started_at", "finished_at", "created_at") SELECT "id", "uuid", "type", "status", "total_files", "processed_files", "failed_files", "create_folder_playlists", "compress_audio", "started_at", "finished_at", "created_at" FROM `import_jobs`;--> statement-breakpoint
DROP TABLE `import_jobs`;--> statement-breakpoint
ALTER TABLE `__new_import_jobs` RENAME TO `import_jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `import_jobs_uuid_unique` ON `import_jobs` (`uuid`);--> statement-breakpoint
ALTER TABLE `tracks` ADD `source_provider` text;--> statement-breakpoint
ALTER TABLE `tracks` ADD `source_url` text;
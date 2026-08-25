CREATE TABLE `library_roots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_roots_uuid_unique` ON `library_roots` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `library_roots_path_unique` ON `library_roots` (`path`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_import_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_files` integer DEFAULT 0 NOT NULL,
	`processed_files` integer DEFAULT 0 NOT NULL,
	`failed_files` integer DEFAULT 0 NOT NULL,
	`create_folder_playlists` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "chk_import_jobs_type" CHECK("__new_import_jobs"."type" IN ('upload','scan','folder_scan')),
	CONSTRAINT "chk_import_jobs_status" CHECK("__new_import_jobs"."status" IN ('pending','running','completed','completed_with_errors','failed','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_import_jobs`("id", "uuid", "type", "status", "total_files", "processed_files", "failed_files", "create_folder_playlists", "started_at", "finished_at", "created_at") SELECT "id", "uuid", "type", "status", "total_files", "processed_files", "failed_files", "create_folder_playlists", "started_at", "finished_at", "created_at" FROM `import_jobs`;--> statement-breakpoint
DROP TABLE `import_jobs`;--> statement-breakpoint
ALTER TABLE `__new_import_jobs` RENAME TO `import_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `import_jobs_uuid_unique` ON `import_jobs` (`uuid`);--> statement-breakpoint
DROP INDEX `tracks_path_unique`;--> statement-breakpoint
ALTER TABLE `tracks` ADD `library_root_id` integer REFERENCES library_roots(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tracks_path_root` ON `tracks` (`path`,`library_root_id`);--> statement-breakpoint
CREATE INDEX `idx_tracks_library_root` ON `tracks` (`library_root_id`);--> statement-breakpoint
ALTER TABLE `import_job_files` ADD `library_root_id` integer REFERENCES library_roots(id) ON DELETE SET NULL;
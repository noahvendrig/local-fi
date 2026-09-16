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
	`compress_audio` integer DEFAULT 0 NOT NULL,
	`target_playlist_id` integer,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`target_playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chk_import_jobs_type" CHECK("__new_import_jobs"."type" IN ('upload','scan','folder_scan','spotify_import')),
	CONSTRAINT "chk_import_jobs_status" CHECK("__new_import_jobs"."status" IN ('pending','running','completed','completed_with_errors','failed','cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_import_jobs`("id", "uuid", "type", "status", "total_files", "processed_files", "failed_files", "create_folder_playlists", "compress_audio", "target_playlist_id", "started_at", "finished_at", "created_at") SELECT "id", "uuid", "type", "status", "total_files", "processed_files", "failed_files", "create_folder_playlists", "compress_audio", "target_playlist_id", "started_at", "finished_at", "created_at" FROM `import_jobs`;
--> statement-breakpoint
DROP TABLE `import_jobs`;
--> statement-breakpoint
ALTER TABLE `__new_import_jobs` RENAME TO `import_jobs`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE UNIQUE INDEX `import_jobs_uuid_unique` ON `import_jobs` (`uuid`);

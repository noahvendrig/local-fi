CREATE TABLE `library_root_crates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_root_id` integer NOT NULL,
	`playlist_id` integer NOT NULL,
	`subfolder_path` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`library_root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_library_root_crates_scope` ON `library_root_crates` (`library_root_id`,`subfolder_path`);--> statement-breakpoint
ALTER TABLE `library_roots` ADD `total_file_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `library_roots` ADD `sync_to_crate` integer DEFAULT 0 NOT NULL;
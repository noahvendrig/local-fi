ALTER TABLE `import_job_files` ADD `source_folder` text;--> statement-breakpoint
ALTER TABLE `import_jobs` ADD `create_folder_playlists` integer DEFAULT 0 NOT NULL;
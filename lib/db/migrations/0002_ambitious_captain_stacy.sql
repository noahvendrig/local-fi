CREATE TABLE `play_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`track_id` integer NOT NULL,
	`played_at` text NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_play_events_track` ON `play_events` (`track_id`);--> statement-breakpoint
CREATE INDEX `idx_play_events_played_at` ON `play_events` (`played_at`);
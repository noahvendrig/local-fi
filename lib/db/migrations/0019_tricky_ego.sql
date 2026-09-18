-- Dedupe tracks that were inserted twice for the same Spotify source (a check-then-act race in
-- spotifyPipeline.ts let two concurrent import workers both pass the "does this source_url
-- already exist" check before either had finished its YouTube match+download+insert). For each
-- group sharing (source_provider, source_url), keep the earliest row and remap references on the
-- rest onto it before dropping them, so crates/mixtapes/job history don't lose their track.
CREATE TEMP TABLE `track_dedup_map` AS
SELECT `t`.`id` AS `dup_id`, `k`.`keep_id` AS `keep_id`
FROM `tracks` `t`
JOIN (
  SELECT `source_provider`, `source_url`, MIN(`id`) AS `keep_id`
  FROM `tracks`
  WHERE `source_url` IS NOT NULL
  GROUP BY `source_provider`, `source_url`
  HAVING COUNT(*) > 1
) `k` ON `t`.`source_provider` = `k`.`source_provider` AND `t`.`source_url` = `k`.`source_url`
WHERE `t`.`id` != `k`.`keep_id`;
--> statement-breakpoint
UPDATE `playlist_tracks`
SET `track_id` = (SELECT `keep_id` FROM `track_dedup_map` WHERE `dup_id` = `playlist_tracks`.`track_id`)
WHERE `track_id` IN (SELECT `dup_id` FROM `track_dedup_map`);
--> statement-breakpoint
UPDATE `mixtapes`
SET `library_track_id` = (SELECT `keep_id` FROM `track_dedup_map` WHERE `dup_id` = `mixtapes`.`library_track_id`)
WHERE `library_track_id` IN (SELECT `dup_id` FROM `track_dedup_map`);
--> statement-breakpoint
UPDATE `mixtape_segments`
SET `matched_track_id` = (SELECT `keep_id` FROM `track_dedup_map` WHERE `dup_id` = `mixtape_segments`.`matched_track_id`)
WHERE `matched_track_id` IN (SELECT `dup_id` FROM `track_dedup_map`);
--> statement-breakpoint
UPDATE `import_job_files`
SET `track_id` = (SELECT `keep_id` FROM `track_dedup_map` WHERE `dup_id` = `import_job_files`.`track_id`)
WHERE `track_id` IN (SELECT `dup_id` FROM `track_dedup_map`);
--> statement-breakpoint
-- Remapping playlist_tracks above can leave a crate with two rows for the same track (it already
-- had the surviving copy, plus the duplicate's now-remapped row) — collapse those too.
DELETE FROM `playlist_tracks`
WHERE `id` NOT IN (SELECT MIN(`id`) FROM `playlist_tracks` GROUP BY `playlist_id`, `track_id`);
--> statement-breakpoint
DELETE FROM `tracks` WHERE `id` IN (SELECT `dup_id` FROM `track_dedup_map`);
--> statement-breakpoint
DROP TABLE `track_dedup_map`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tracks_source` ON `tracks` (`source_provider`,`source_url`) WHERE "tracks"."source_url" IS NOT NULL;

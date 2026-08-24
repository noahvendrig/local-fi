import { alias } from "drizzle-orm/sqlite-core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import type { TrackSummary } from "@/lib/api-client";
import { albums, artists, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";
import { compileRules, type RuleQueryContext } from "./compileRules";
import type { RuleGroup } from "./rules";

const SMART_CRATE_SORTS = {
  date_added_desc: { expr: tracks.dateAdded, dir: "desc" as const },
  date_added_asc: { expr: tracks.dateAdded, dir: "asc" as const },
  title_asc: { expr: sql`coalesce(${tracks.title}, '')`, dir: "asc" as const },
  title_desc: { expr: sql`coalesce(${tracks.title}, '')`, dir: "desc" as const },
  duration_asc: { expr: tracks.durationSeconds, dir: "asc" as const },
  duration_desc: { expr: tracks.durationSeconds, dir: "desc" as const },
};
export type SmartCrateSort = keyof typeof SMART_CRATE_SORTS;
export const SMART_CRATE_SORT_KEYS = Object.keys(SMART_CRATE_SORTS) as SmartCrateSort[];

const RESULT_LIMIT = 500;

/**
 * Evaluates a rule tree against the live library — no cached membership, so a track
 * imported after a smart crate is saved shows up on the next read (ARCHITECTURE.md M7's
 * "rules are evaluated live at query time" demoable requirement).
 */
export function evaluateSmartCrate(db: ReturnType<typeof getDb>, rules: RuleGroup, sortField: string | null): TrackSummary[] {
  const albumArtistTable = alias(artists, "album_artist_credit");
  const ctx: RuleQueryContext = { trackArtistName: artists.name, albumArtistName: albumArtistTable.name };

  const sortCfg = SMART_CRATE_SORTS[(sortField as SmartCrateSort) ?? "date_added_desc"] ?? SMART_CRATE_SORTS.date_added_desc;
  const condition = compileRules(rules, ctx);

  const rows = db
    .select(trackSummarySelectColumns)
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(albumArtistTable, eq(albums.albumArtistId, albumArtistTable.id))
    .where(and(isNull(tracks.deletedAt), condition))
    .orderBy(sortCfg.dir === "desc" ? desc(sortCfg.expr) : asc(sortCfg.expr))
    .limit(RESULT_LIMIT)
    .all();

  return rows.map(mapTrackSummaryRow);
}

import { and, gt, inArray, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { albums, tracks } from "@/lib/db/schema";
import { isRuleGroup, type RuleCondition, type RuleField, type RuleNode } from "./rules";

/**
 * The joined artist-name columns a compiled rule tree references — the base query must
 * join a second, aliased `artists` table for the album-artist field (a track's performing
 * artist and its album's artist are two different joins of the same table).
 */
export interface RuleQueryContext {
  /** artists.name joined via tracks.artistId — the track's primary/performing artist. */
  trackArtistName: SQLiteColumn;
  /** artists.name joined via albums.albumArtistId — a second, aliased join of the same table. */
  albumArtistName: SQLiteColumn;
}

function fieldColumn(field: RuleField, ctx: RuleQueryContext): SQLiteColumn {
  switch (field) {
    case "format":
      return tracks.format;
    case "lossless":
      return tracks.lossless;
    case "genre":
      return tracks.genre;
    case "year":
      return tracks.year;
    case "dateAdded":
      return tracks.dateAdded;
    case "bitrate":
      return tracks.bitrate;
    case "sampleRate":
      return tracks.sampleRate;
    case "durationSeconds":
      return tracks.durationSeconds;
    case "playCount":
      return tracks.playCount;
    case "lastPlayedAt":
      return tracks.lastPlayedAt;
    case "artist":
      return ctx.trackArtistName;
    case "albumArtist":
      return ctx.albumArtistName;
    case "album":
      return albums.title;
  }
}

function scalarValue(cond: RuleCondition): string | number {
  // lossless is stored as INTEGER 0/1; every other scalar field's wire type already
  // matches its column type.
  if (cond.field === "lossless") return cond.value ? 1 : 0;
  return cond.value as string | number;
}

function compileCondition(cond: RuleCondition, ctx: RuleQueryContext): SQL {
  const col = fieldColumn(cond.field, ctx);

  switch (cond.op) {
    case "eq":
      return sql`${col} = ${scalarValue(cond)}`;
    case "neq":
      return sql`${col} != ${scalarValue(cond)}`;
    case "gt":
      return gt(col, scalarValue(cond));
    case "gte":
      return sql`${col} >= ${scalarValue(cond)}`;
    case "lt":
      return lt(col, scalarValue(cond));
    case "lte":
      return sql`${col} <= ${scalarValue(cond)}`;
    case "in":
      return inArray(col, cond.value as (string | number)[]);
    case "not_in":
      return notInArray(col, cond.value as (string | number)[]);
    case "contains":
      return sql`lower(${col}) LIKE ${`%${String(cond.value).toLowerCase()}%`}`;
    case "within_days":
      return sql`${col} >= datetime('now', ${`-${Number(cond.value)} days`})`;
    case "before":
      return sql`${col} < ${cond.value}`;
    case "after":
      return sql`${col} > ${cond.value}`;
  }
}

/** Walks a smart-crate rule tree into a parameterized Drizzle WHERE expression (ARCHITECTURE.md §3.4). */
export function compileRules(node: RuleNode, ctx: RuleQueryContext): SQL {
  if (isRuleGroup(node)) {
    const parts = node.conditions.map((c) => compileRules(c, ctx));
    if (parts.length === 0) return sql`1=1`; // an empty group matches everything — a fresh crate's starting state
    const combined = node.match === "all" ? and(...parts) : or(...parts);
    return combined ?? sql`1=1`;
  }
  return compileCondition(node, ctx);
}

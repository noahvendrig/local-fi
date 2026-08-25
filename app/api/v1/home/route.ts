import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { albums, artists, playEvents, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";

const WINDOW_DAYS = 7;
const BACK_IN_ROTATION_GAP_DAYS = 21;
const BACK_IN_ROTATION_LIMIT = 3;
const TOP_LIMIT = 5;
const FORMAT_LIMIT = 4;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function formatListeningTime(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/**
 * GET /api/v1/home — weekly listening-stats dashboard (design board 1, "isHome" section).
 * Everything below is scoped to a rolling trailing-7-day window and sourced from `play_events`
 * (written by POST /api/v1/tracks/:id/play on natural track completion) plus `tracks.dateAdded`
 * for the one stat that needs no play history. A brand-new library with no listens yet is a
 * normal state: every list comes back empty and the client renders an empty-state instead.
 */
export async function GET() {
  const db = getDb();
  const windowStart = daysAgoIso(WINDOW_DAYS);
  const backInRotationThreshold = daysAgoIso(WINDOW_DAYS + BACK_IN_ROTATION_GAP_DAYS);

  const weekAgg = db
    .select({
      plays: sql<number>`count(*)`,
      seconds: sql<number>`coalesce(sum(${tracks.durationSeconds}), 0)`,
    })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .where(gte(playEvents.playedAt, windowStart))
    .get()!;

  const tracksAdded = db
    .select({ count: sql<number>`count(*)` })
    .from(tracks)
    .where(and(gte(tracks.dateAdded, windowStart), isNull(tracks.deletedAt)))
    .get()!;

  const stats = [
    {
      label: "Plays this week",
      value: String(weekAgg.plays),
      meta: weekAgg.plays > 0 ? `${(weekAgg.plays / WINDOW_DAYS).toFixed(1)}/day avg` : "last 7 days",
    },
    {
      label: "Listening time",
      value: formatListeningTime(weekAgg.seconds),
      meta: "last 7 days",
    },
    {
      label: "Tracks added",
      value: String(tracksAdded.count),
      meta: "last 7 days",
    },
  ];

  const top5Rows = db
    .select({ ...trackSummarySelectColumns, plays: sql<number>`count(*)`.as("plays") })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .where(and(gte(playEvents.playedAt, windowStart), isNull(tracks.deletedAt)))
    .groupBy(tracks.id)
    .orderBy(desc(sql`plays`))
    .limit(TOP_LIMIT)
    .all();

  const top5Max = top5Rows[0]?.plays ?? 0;
  const top5 = top5Rows.map((row, i) => ({
    rank: i + 1,
    plays: row.plays,
    barW: top5Max > 0 ? Math.round((row.plays / top5Max) * 100) : 0,
    track: mapTrackSummaryRow(row),
  }));

  const topArtistRows = db
    .select({
      artistId: artists.id,
      name: artists.name,
      plays: sql<number>`count(*)`.as("plays"),
    })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .where(and(gte(playEvents.playedAt, windowStart), isNull(tracks.deletedAt)))
    .groupBy(artists.id)
    .orderBy(desc(sql`plays`))
    .limit(TOP_LIMIT)
    .all();

  const topArtistMax = topArtistRows[0]?.plays ?? 0;
  const topArtists = topArtistRows.map((row) => ({
    artistId: row.artistId,
    name: row.name,
    plays: row.plays,
    barW: topArtistMax > 0 ? Math.round((row.plays / topArtistMax) * 100) : 0,
  }));

  const dayRows = db
    .select({
      day: sql<string>`substr(${playEvents.playedAt}, 1, 10)`.as("day"),
      plays: sql<number>`count(*)`.as("plays"),
    })
    .from(playEvents)
    .where(gte(playEvents.playedAt, windowStart))
    .groupBy(sql`day`)
    .all();
  const playsByDate = new Map(dayRows.map((r) => [r.day, r.plays]));

  const days: { date: string; label: string; plays: number }[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    days.push({
      date: key,
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      plays: playsByDate.get(key) ?? 0,
    });
  }
  const dayMax = Math.max(1, ...days.map((d) => d.plays));
  const daysOut = days.map((d) => ({ ...d, h: Math.round((d.plays / dayMax) * 100) }));

  const formatRows = db
    .select({
      format: tracks.format,
      plays: sql<number>`count(*)`.as("plays"),
    })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .where(and(gte(playEvents.playedAt, windowStart), isNull(tracks.deletedAt)))
    .groupBy(tracks.format)
    .orderBy(desc(sql`plays`))
    .all();
  const formatTotal = formatRows.reduce((sum, r) => sum + r.plays, 0);
  const formats = formatRows.slice(0, FORMAT_LIMIT).map((row) => ({
    format: row.format,
    plays: row.plays,
    pct: formatTotal > 0 ? Math.round((row.plays / formatTotal) * 100) : 0,
  }));

  // "Back in rotation": tracks played this week whose most recent *prior* play (before the
  // window) happened more than BACK_IN_ROTATION_GAP_DAYS before the window even started.
  const inWindowRows = db
    .select({ trackId: playEvents.trackId, lastInWindow: sql<string>`max(${playEvents.playedAt})`.as("lastInWindow") })
    .from(playEvents)
    .where(gte(playEvents.playedAt, windowStart))
    .groupBy(playEvents.trackId)
    .all();
  const priorRows = db
    .select({ trackId: playEvents.trackId, lastPrior: sql<string>`max(${playEvents.playedAt})`.as("lastPrior") })
    .from(playEvents)
    .where(lt(playEvents.playedAt, windowStart))
    .groupBy(playEvents.trackId)
    .all();
  const priorByTrack = new Map(priorRows.map((r) => [r.trackId, r.lastPrior]));

  const backInRotationCandidates = inWindowRows
    .map((r) => ({ trackId: r.trackId, lastInWindow: r.lastInWindow, lastPrior: priorByTrack.get(r.trackId) }))
    .filter((r): r is { trackId: number; lastInWindow: string; lastPrior: string } => !!r.lastPrior && r.lastPrior <= backInRotationThreshold)
    .sort((a, b) => (a.lastInWindow < b.lastInWindow ? 1 : -1))
    .slice(0, BACK_IN_ROTATION_LIMIT);

  const backInRotationIds = backInRotationCandidates.map((c) => c.trackId);
  const backInRotationTrackRows = backInRotationIds.length
    ? db
        .select(trackSummarySelectColumns)
        .from(tracks)
        .leftJoin(artists, eq(tracks.artistId, artists.id))
        .leftJoin(albums, eq(tracks.albumId, albums.id))
        .where(and(inArray(tracks.id, backInRotationIds), isNull(tracks.deletedAt)))
        .all()
    : [];
  const backInRotationTrackById = new Map(backInRotationTrackRows.map((r) => [r.id, mapTrackSummaryRow(r)]));

  const backInRotation = backInRotationCandidates
    .filter((c) => backInRotationTrackById.has(c.trackId))
    .map((c) => {
      const gapDays = Math.max(1, Math.round((Date.parse(c.lastInWindow) - Date.parse(c.lastPrior)) / 86400_000));
      return {
        meta: `back after ${gapDays} day${gapDays === 1 ? "" : "s"}`,
        track: backInRotationTrackById.get(c.trackId)!,
      };
    });

  return NextResponse.json({
    rangeLabel: "last 7 days",
    stats,
    top5,
    backInRotation,
    topArtists,
    days: daysOut,
    formats,
  });
}

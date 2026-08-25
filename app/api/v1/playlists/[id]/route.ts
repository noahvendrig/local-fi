import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePlaylistRecord } from "@/lib/crates/coverArt";
import { evaluateSmartCrate } from "@/lib/crates/evaluateRules";
import { RuleGroupSchema } from "@/lib/crates/rules";
import { toPlaylistJson } from "@/lib/crates/serialize";
import { getDb } from "@/lib/db/client";
import { albums, artists, libraryRootCrates, libraryRoots, playlistTracks, playlists, tracks } from "@/lib/db/schema";
import { mapTrackSummaryRow, trackSummarySelectColumns } from "@/lib/db/trackSummary";

const NOT_FOUND = NextResponse.json({ error: { code: "not_found", message: "Playlist not found." } }, { status: 404 });

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  rulesJson: RuleGroupSchema.optional(),
  sortField: z.string().nullable().optional(),
});

/** GET /api/v1/playlists/:id — manual: ordered tracks; smart: live-evaluated tracks (ARCHITECTURE.md §7). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) return NOT_FOUND;

  const db = getDb();
  const playlist = db.select().from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!playlist) return NOT_FOUND;

  let trackList: (ReturnType<typeof mapTrackSummaryRow> & { entryId: number | null; position: string | null })[];

  if (playlist.type === "manual") {
    const entryRows = db
      .select({ entryId: playlistTracks.id, position: playlistTracks.position, ...trackSummarySelectColumns })
      .from(playlistTracks)
      .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
      .leftJoin(artists, eq(tracks.artistId, artists.id))
      .leftJoin(albums, eq(tracks.albumId, albums.id))
      .where(and(eq(playlistTracks.playlistId, playlistId), isNull(tracks.deletedAt)))
      .orderBy(asc(playlistTracks.position))
      .all();

    trackList = entryRows.map((row) => ({ ...mapTrackSummaryRow(row), entryId: row.entryId, position: row.position }));
  } else {
    const rules = playlist.rulesJson ? JSON.parse(playlist.rulesJson) : { match: "all", conditions: [] };
    trackList = evaluateSmartCrate(db, rules, playlist.sortField).map((t) => ({ ...t, entryId: null, position: null }));
  }

  const syncLink = db
    .select({ rootId: libraryRoots.id, rootName: libraryRoots.name, syncToCrate: libraryRoots.syncToCrate })
    .from(libraryRootCrates)
    .innerJoin(libraryRoots, eq(libraryRootCrates.libraryRootId, libraryRoots.id))
    .where(eq(libraryRootCrates.playlistId, playlistId))
    .get();
  const librarySync = syncLink
    ? { rootId: syncLink.rootId, rootName: syncLink.rootName, syncToCrate: syncLink.syncToCrate === 1 }
    : null;

  return NextResponse.json({ ...toPlaylistJson(playlist), tracks: trackList, librarySync });
}

/** PATCH /api/v1/playlists/:id — rename/describe/update rules (ARCHITECTURE.md §7). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) return NOT_FOUND;

  const db = getDb();
  const existing = db.select().from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!existing) return NOT_FOUND;

  const body = await request.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid playlist update.", details: parsed.error.flatten() } },
      { status: 400 }
    );
  }

  if (parsed.data.rulesJson && existing.type !== "smart") {
    return NextResponse.json(
      { error: { code: "invalid_rules", message: "rulesJson can only be set on a smart crate." } },
      { status: 422 }
    );
  }

  const now = new Date().toISOString();
  const updated = db
    .update(playlists)
    .set({
      name: parsed.data.name ?? existing.name,
      description: parsed.data.description !== undefined ? parsed.data.description : existing.description,
      rulesJson: parsed.data.rulesJson ? JSON.stringify(parsed.data.rulesJson) : existing.rulesJson,
      sortField: parsed.data.sortField !== undefined ? parsed.data.sortField : existing.sortField,
      updatedAt: now,
    })
    .where(eq(playlists.id, playlistId))
    .returning()
    .get();

  return NextResponse.json(toPlaylistJson(updated));
}

/** DELETE /api/v1/playlists/:id — cascades to playlist_tracks (ARCHITECTURE.md §7). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playlistId = Number(id);
  if (!Number.isInteger(playlistId)) return NOT_FOUND;

  if (!deletePlaylistRecord(playlistId)) return NOT_FOUND;
  return new NextResponse(null, { status: 204 });
}

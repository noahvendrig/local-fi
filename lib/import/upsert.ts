import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { albumArtists, albums, artists, trackArtists } from "../db/schema";
import type * as schema from "../db/schema";
import { albumFingerprint, artistFingerprint, computeSortName } from "./fingerprint";

// Accepts both the plain DB handle and a transaction handle — both are
// BaseSQLiteDatabase in "sync" mode (better-sqlite3), so upsert logic works
// identically whether called standalone or inside db.transaction().
type Db = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

/** Finds an artist by fingerprint or inserts a new one (ARCHITECTURE.md §3.3). */
export function upsertArtist(db: Db, name: string): typeof artists.$inferSelect {
  const fingerprint = artistFingerprint(name);
  const existing = db.select().from(artists).where(eq(artists.fingerprint, fingerprint)).get();
  if (existing) return existing;

  const inserted = db
    .insert(artists)
    .values({ uuid: randomUUID(), name, sortName: computeSortName(name), fingerprint })
    .returning()
    .get();
  return inserted;
}

/** Finds an album by (title, albumArtist) fingerprint or inserts a new one (ARCHITECTURE.md §3.2/§3.3). */
export function upsertAlbum(
  db: Db,
  title: string,
  albumArtistId: number | null,
  year: number | null
): typeof albums.$inferSelect {
  const fingerprint = albumFingerprint(title, albumArtistId);
  const existing = db.select().from(albums).where(eq(albums.fingerprint, fingerprint)).get();
  if (existing) return existing;

  const inserted = db
    .insert(albums)
    .values({
      uuid: randomUUID(),
      title,
      albumArtistId,
      year,
      fingerprint,
      dateAdded: new Date().toISOString(),
    })
    .returning()
    .get();
  return inserted;
}

/** Idempotently links an album to its credited artist at `position` (ARCHITECTURE.md §3.3). */
export function ensureAlbumArtistLink(db: Db, albumId: number, artistId: number, position = 0): void {
  const existing = db
    .select()
    .from(albumArtists)
    .where(eq(albumArtists.albumId, albumId))
    .all()
    .find((row) => row.artistId === artistId);
  if (existing) return;
  db.insert(albumArtists).values({ albumId, artistId, position }).run();
}

/** Idempotently links a track to its performing artist at `position` (ARCHITECTURE.md §3.3). */
export function ensureTrackArtistLink(
  db: Db,
  trackId: number,
  artistId: number,
  role: "primary" | "featured" = "primary",
  position = 0
): void {
  const existing = db
    .select()
    .from(trackArtists)
    .where(eq(trackArtists.trackId, trackId))
    .all()
    .find((row) => row.artistId === artistId && row.role === role);
  if (existing) return;
  db.insert(trackArtists).values({ trackId, artistId, role, position }).run();
}

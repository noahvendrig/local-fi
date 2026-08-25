import { existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ZipFile } from "yazl";
import { getDb } from "@/lib/db/client";
import { artists, playlistTracks, playlists, tracks } from "@/lib/db/schema";
import { getDataDir } from "@/lib/storage/dataDir";
import { evaluateSmartCrate } from "./evaluateRules";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// ASCII Windows-illegal chars plus their fullwidth lookalikes (e.g. U+FF5C "｜").
const UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001f\uFF02\uFF0A\uFF0F\uFF1A\uFF1C\uFF1E\uFF1F\uFF3C\uFF5C]/g;

export type PlaylistExportError = "not_found" | "empty" | "no_files";

export type PlaylistExportReady = {
  zipFilename: string;
  folderName: string;
  entries: { absPath: string; zipPath: string }[];
};

type TrackFileRow = {
  id: number;
  path: string;
  title: string | null;
  format: string;
  artistName: string | null;
};

/** Strips filesystem-hostile characters so zip entry names extract cleanly on Windows. */
export function sanitizeZipComponent(name: string): string {
  let cleaned = name.replace(UNSAFE_CHARS, "_").replace(/[. ]+$/g, "").trim();
  if (cleaned.length === 0) cleaned = "untitled";
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`;
  if (cleaned.length > 120) cleaned = cleaned.slice(0, 120).replace(/[. ]+$/g, "") || "untitled";
  return cleaned;
}

export function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function trackBasename(row: TrackFileRow): string {
  const original = path.basename(row.path);
  const ext = path.extname(original) || `.${row.format}`;
  const stem = path.basename(original, path.extname(original));
  if (stem) return `${sanitizeZipComponent(stem)}${ext}`;
  const title = row.title?.trim();
  const artist = row.artistName?.trim();
  if (title && artist) return `${sanitizeZipComponent(artist)} - ${sanitizeZipComponent(title)}${ext}`;
  if (title) return `${sanitizeZipComponent(title)}${ext}`;
  return `track${ext}`;
}

function toExportEntries(folderName: string, rows: TrackFileRow[]): PlaylistExportReady["entries"] {
  const present = rows
    .map((row) => ({ row, absPath: path.join(getDataDir(), row.path) }))
    .filter((item) => existsSync(item.absPath));

  const pad = Math.max(2, String(present.length).length);
  const used = new Set<string>();
  const entries: PlaylistExportReady["entries"] = [];

  present.forEach((item, index) => {
    const order = String(index + 1).padStart(pad, "0");
    let name = `${order} - ${trackBasename(item.row)}`;
    if (used.has(name)) {
      const ext = path.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let n = 2;
      do {
        name = `${stem} (${n})${ext}`;
        n += 1;
      } while (used.has(name));
    }
    used.add(name);
    entries.push({ absPath: item.absPath, zipPath: `${folderName}/${name}` });
  });

  return entries;
}

function loadManualTrackFiles(playlistId: number): TrackFileRow[] {
  return getDb()
    .select({
      id: tracks.id,
      path: tracks.path,
      title: tracks.title,
      format: tracks.format,
      artistName: artists.name,
    })
    .from(playlistTracks)
    .innerJoin(tracks, eq(playlistTracks.trackId, tracks.id))
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .where(and(eq(playlistTracks.playlistId, playlistId), isNull(tracks.deletedAt), isNull(tracks.missingSince)))
    .orderBy(asc(playlistTracks.position))
    .all();
}

function loadSmartTrackFiles(playlistId: number, rulesJson: string | null, sortField: string | null): TrackFileRow[] {
  const rules = rulesJson ? JSON.parse(rulesJson) : { match: "all", conditions: [] };
  const summaries = evaluateSmartCrate(getDb(), rules, sortField).filter((t) => !t.missing);
  if (summaries.length === 0) return [];

  const ids = summaries.map((t) => t.id);
  const rows = getDb()
    .select({
      id: tracks.id,
      path: tracks.path,
      title: tracks.title,
      format: tracks.format,
      artistName: artists.name,
    })
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .where(and(inArray(tracks.id, ids), isNull(tracks.deletedAt), isNull(tracks.missingSince)))
    .all();

  const byId = new Map(rows.map((row) => [row.id, row]));
  return summaries.map((t) => byId.get(t.id)).filter((row): row is TrackFileRow => row != null);
}

/** Resolves the crate's current tracks to on-disk files, in playlist order. */
export function preparePlaylistExport(playlistId: number): PlaylistExportReady | { error: PlaylistExportError } {
  const playlist = getDb().select().from(playlists).where(eq(playlists.id, playlistId)).get();
  if (!playlist) return { error: "not_found" };

  const rows =
    playlist.type === "manual"
      ? loadManualTrackFiles(playlistId)
      : loadSmartTrackFiles(playlistId, playlist.rulesJson, playlist.sortField);

  if (rows.length === 0) return { error: "empty" };

  const folderName = sanitizeZipComponent(playlist.name);
  const entries = toExportEntries(folderName, rows);
  if (entries.length === 0) return { error: "no_files" };

  return { zipFilename: `${folderName}.zip`, folderName, entries };
}

/** Streams a store-method zip (no recompression — audio is already compressed). */
export function createPlaylistZipStream(entries: PlaylistExportReady["entries"]): ReadableStream {
  const zipfile = new ZipFile();
  const stream = Readable.toWeb(zipfile.outputStream as unknown as Readable) as ReadableStream;
  for (const entry of entries) {
    zipfile.addFile(entry.absPath, entry.zipPath, { compress: false });
  }
  zipfile.end();
  return stream;
}

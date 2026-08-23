# ARCHITECTURE.md — local-fi

Status: Phase 0 design. Covers only the Library Server (backend) and the desktop web player UI.
Explicitly out of scope for this phase (see Appendix for forward-looking notes): metadata web-lookup, Spotify/yt-dlp import, an Android client, the opt-in cloud/social service.

## 1. Stack summary

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router), TypeScript, React 19 | Single codebase; API routes are the real backend |
| Styling | Tailwind CSS v4 | CSS-first config (`@theme` in CSS, no `tailwind.config.js`) |
| Database | SQLite (single file), Drizzle ORM, `better-sqlite3` driver | See §4 |
| File storage | Local filesystem under `LOCALFI_DATA_DIR` | DB stores paths only, never blobs |
| Tag reading | `music-metadata` | Read-only; see §5 |
| Tag writing | `node-taglib-sharp` | See §5 |
| Audio decode (waveform) | System `ffmpeg` binary, on PATH | See §6 |
| Client server-state cache | TanStack Query v5 | Keeps data-fetching out of page components |
| Client UI/player state | Zustand | Queue/transport/panel state |
| Validation | Zod | Request bodies, smart-crate rule trees |
| Reorderable position | `fractional-indexing` | Playlist/queue drag-reorder, see §3.4 |
| Runtime target | Node.js 22 LTS+ | Matches Next 16's minimum |

API is versioned under **`/api/v1/`**. Tradeoff: a small amount of path verbosity for what is currently a single client. Decided yes anyway — the API is explicitly designed for a second client (a future Android app) to consume later, and the URL is part of the wire contract. Adding a version prefix after the fact means either breaking the first client or living with an unversioned legacy path forever; doing it now costs nothing.

---

## 2. File storage layout

```
LOCALFI_DATA_DIR/                    (env LOCALFI_DATA_DIR, default ./data)
├── library.db                       # SQLite file (WAL mode)
├── library.db-wal / library.db-shm
├── auth-token                       # generated bearer token, see §8
├── originals/
│   └── <2-char shard>/<track-uuid>/<sanitized-original-filename>.<ext>
│       e.g. originals/a3/a3f9c2e1-4b7d-.../01 - Song Title.flac
├── artwork/
│   └── <2-char shard>/<track-or-album-uuid>.<ext>
├── waveforms/
│   └── <2-char shard>/<track-uuid>.lfpk      # compact binary peak sidecar, see §3.5
├── staging/
│   └── <import-job-uuid>/<original-filename> # in-flight uploads before tag/waveform processing succeeds
├── trash/
│   └── <track-uuid>/<original-filename>      # soft-deleted files, purged after N days
└── tmp/                              # scratch space, cleared on every process start
```

- **Sharding**: files are bucketed under a 2-character prefix of their UUID to avoid tens of thousands of siblings in one directory (large flat directories degrade on most filesystems, NTFS included). Standard content-addressable-storage pattern.
- **Copy-on-import, not watch-in-place**: v1 copies dropped files into `originals/`, matching the Ingest tray upload model. `tracks.path` is just a path string, so a future "watch an existing folder without copying" mode is a zero-schema-change addition later.
- **Staging → originals is atomic**: files move into `originals/` via `fs.rename` only after tag extraction *and* waveform generation succeed. A crash mid-import leaves orphaned entries in `staging/`, swept on next startup (§3.7).
- **Delete is soft by default**: "Remove from library" moves the file to `trash/<uuid>/` and sets `tracks.deleted_at`, rather than unlinking immediately. A scheduled sweep purges anything in `trash/` older than a configurable grace period (default 14 days). This is distinct from a *missing* file (§3.1) — a file the app can no longer find on disk was never explicitly deleted, so it's never moved or unlinked automatically.

---

## 3. Data model

### Design principle: the file is the source of truth for tags; SQLite is a fast, queryable index over it.

Any tag edit (via the metadata editor) is written to the physical file first (`node-taglib-sharp`), then the DB row is updated from those same values. Rescans re-read files and upsert — they never need to protect a "DB-only" edit from being overwritten, because there is no such thing. This avoids an entire class of "why did my edit disappear after a rescan" bugs.

### 3.1 `tracks`

```sql
CREATE TABLE tracks (
  id                  INTEGER PRIMARY KEY,
  uuid                TEXT NOT NULL UNIQUE,             -- stable external id
  path                TEXT NOT NULL UNIQUE,             -- relative to LOCALFI_DATA_DIR/originals
  fingerprint         TEXT NOT NULL,                    -- change-detection key, see §3.6
  file_mtime          TEXT NOT NULL,                    -- ISO8601, captured at last scan
  file_size_bytes     INTEGER NOT NULL,

  title               TEXT,
  artist_id           INTEGER REFERENCES artists(id),   -- denormalized "primary" artist, see §3.3
  album_id            INTEGER REFERENCES albums(id),
  track_number        INTEGER,
  track_total         INTEGER,
  disc_number         INTEGER,
  disc_total          INTEGER,
  year                INTEGER,
  genre               TEXT,                             -- free text, see note below

  duration_seconds    REAL NOT NULL,
  format              TEXT NOT NULL CHECK (format IN ('mp3','flac','wav','aac','m4a','ogg','alac','aiff')),
  codec               TEXT,                              -- finer-grained, e.g. 'aac-lc'
  bitrate             INTEGER,                           -- bits/sec, null where not meaningful (e.g. WAV)
  sample_rate         INTEGER,
  bit_depth           INTEGER,
  channels             INTEGER,
  lossless            INTEGER NOT NULL DEFAULT 0,        -- denormalized boolean, see note below

  cover_art_path      TEXT,
  waveform_path       TEXT,
  waveform_status     TEXT NOT NULL DEFAULT 'pending' CHECK (waveform_status IN ('pending','processing','ready','failed')),
  waveform_peak_count INTEGER,
  waveform_avg_level  REAL,

  play_count          INTEGER NOT NULL DEFAULT 0,
  last_played_at      TEXT,

  raw_tags_json       TEXT,                              -- full raw tag dump captured at import

  import_job_id       INTEGER REFERENCES import_jobs(id) ON DELETE SET NULL,
  date_added          TEXT NOT NULL,
  date_modified       TEXT,
  missing_since       TEXT,                              -- set by rescan when file can't be found; NULL = present
  deleted_at          TEXT                               -- set by user-initiated delete; NULL = active
);

CREATE UNIQUE INDEX idx_tracks_uuid ON tracks(uuid);
CREATE INDEX idx_tracks_fingerprint ON tracks(fingerprint);
CREATE INDEX idx_tracks_album ON tracks(album_id, disc_number, track_number);
CREATE INDEX idx_tracks_artist ON tracks(artist_id);
CREATE INDEX idx_tracks_missing ON tracks(missing_since);
CREATE INDEX idx_tracks_deleted ON tracks(deleted_at);
CREATE INDEX idx_tracks_lossless ON tracks(lossless);
CREATE INDEX idx_tracks_date_added ON tracks(date_added);
```

Notes / judgment calls:

- **`uuid` alongside integer `id`.** Internal FKs use the fast SQLite rowid-backed `INTEGER PRIMARY KEY`. `uuid` (via `crypto.randomUUID()`, no extra dependency) is a stable external identifier — exactly what a future sync protocol (Android client, cloud/social service) needs as a cross-system reference that survives a local DB rebuild. Cheap now, painful to retrofit onto millions of existing FK relationships later.
- **`lossless` is denormalized** from `format` (`flac`/`wav`/`alac`/`aiff` → 1) rather than computed at query time. It's used constantly by smart crates ("Lossless only") and the list-view format badge — an indexed boolean is simply faster to filter/sort on than re-deriving it every query.
- **`format` includes `alac`/`aiff`** per the design mockup's aspirational format list, but the phase-1 import pipeline (M2) is only validated end-to-end for mp3/flac/wav/aac/m4a/ogg. ALAC (inside an m4a container) will likely partially work since m4a parsing overlaps; AIFF isn't in the phase-1 test matrix. Don't advertise support until it's actually been run through the pipeline.
- **`genre` stays free TEXT**, not normalized into a `genres` table. Real-world tag data is inconsistent (multi-genre strings, freeform values), and there's no faceted-genre-browse requirement this phase. A `genres` + join table is a clean additive migration later if that feature shows up.
- **`raw_tags_json`** is a small insurance policy: it lets a future metadata-enrichment feature re-derive fields without re-reading every file from disk, and helps debug "why did this track import wrong" without re-triggering a scan.
- **Missing vs. deleted are different flows, both retained.** A rescan that can't find a file sets `missing_since` and leaves the row otherwise intact (still browsable/in playlists, greyed out, can't stream) — this is what the Health page surfaces. A user hitting "Remove from library" sets `deleted_at` (moves file to `trash/`, see §2). Hard purge (row actually removed) only happens via an explicit "permanently delete" action or the trash-sweep job.

### 3.2 `albums`

```sql
CREATE TABLE albums (
  id                INTEGER PRIMARY KEY,
  uuid              TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  album_artist_id   INTEGER REFERENCES artists(id),     -- denormalized primary album artist; NULL = various/compilation
  year              INTEGER,
  is_compilation    INTEGER NOT NULL DEFAULT 0,
  cover_art_path    TEXT,
  fingerprint       TEXT NOT NULL,                      -- normalized(title)+normalized(album_artist), for import upsert
  date_added        TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_albums_fingerprint ON albums(fingerprint);
CREATE INDEX idx_albums_artist ON albums(album_artist_id);
```

### 3.3 `artists`, and the many-to-many joins

```sql
CREATE TABLE artists (
  id          INTEGER PRIMARY KEY,
  uuid        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  sort_name   TEXT,                        -- e.g. "Beatles, The"; app computes a default if absent
  fingerprint TEXT NOT NULL                -- normalized(name), for import upsert
);
CREATE UNIQUE INDEX idx_artists_fingerprint ON artists(fingerprint);

CREATE TABLE album_artists (                -- many-to-many: an album's credited artist(s)
  album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, artist_id)
);

CREATE TABLE track_artists (                -- many-to-many: a track's performing/featured artist(s)
  track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','featured')),
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, artist_id, role)
);
```

**Reasoning**: `tracks.artist_id` and `albums.album_artist_id` are kept as denormalized "primary/display" pointers for the common case (single artist), so the hot paths — grid view grouped by artist, list view artist column, sorting — stay single-join queries. `album_artists`/`track_artists` are the actual source of truth for the multi-artist case (compilations, "Artist A & Artist B", featured artists), populated from the primary pointer at import (first row = the denormalized one, kept in sync on edits). Standard normalize-for-correctness / denormalize-for-read-speed tradeoff; it answers the many-to-many Artist↔Album requirement without forcing a "Various Artists" string hack into the primary artist field.

### 3.4 Playlists / Crates

```sql
CREATE TABLE playlists (
  id             INTEGER PRIMARY KEY,
  uuid           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('manual','smart')),
  description    TEXT,
  rules_json     TEXT,                      -- NULL for manual; JSON rule tree for smart, see below
  sort_field     TEXT,                      -- smart-crate result ordering, e.g. 'date_added_desc'
  cover_art_path TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE playlist_tracks (              -- manual membership + order ONLY; smart crates compute membership live
  id           INTEGER PRIMARY KEY,
  playlist_id  INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id     INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position     TEXT NOT NULL,               -- fractional-indexing lexicographic key
  added_at     TEXT NOT NULL
);
CREATE INDEX idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);
```

Duplicates of the same track within one playlist are **allowed** (no unique constraint on `playlist_id, track_id`) — real playlist UX (iTunes, Spotify) permits intentional repeats.

**Ordering scheme: fractional (lexicographic) indexing, not integer resequencing.** `position` is a `TEXT` sort key generated by the `fractional-indexing` algorithm (originally Figma's). Dragging a track to a new position updates **one row** (compute a new key that sorts between its new neighbors) instead of resequencing every row after the insertion point — a real cost difference on a playlist with hundreds of tracks and drag-reorder UX. A pure-float rank scheme has the same O(1)-update property but eventually exhausts representable midpoints after repeated inserts at the same spot; a string-based fractional key never does, because a longer string can always be inserted lexicographically between two others.

**Smart-crate rule schema** (`rules_json`), a small recursive condition tree:

```json
{
  "match": "all",
  "conditions": [
    { "field": "lossless", "op": "eq", "value": true },
    { "field": "dateAdded", "op": "within_days", "value": 30 },
    {
      "match": "any",
      "conditions": [
        { "field": "genre", "op": "eq", "value": "Jazz" },
        { "field": "genre", "op": "eq", "value": "Ambient" }
      ]
    }
  ]
}
```

- `match`: `"all"` (AND) | `"any"` (OR), nestable groups.
- `field`: `format | lossless | genre | artist | albumArtist | album | year | dateAdded | bitrate | sampleRate | durationSeconds | playCount | lastPlayedAt`.
- `op`: `eq | neq | in | not_in | gt | gte | lt | lte | contains | within_days | before | after`, validated per-field-type via Zod (so `gt` can't be applied to a string field, etc).
- Validated at the API boundary; **not** evaluated in JS after fetching everything — a compiler (`lib/crates/compileRules.ts`) walks the tree and builds a real Drizzle `and()/or()/eq()/gt()` expression tree, turning it into a parameterized `WHERE` clause. Drizzle's composable query-builder functions make this straightforward to build recursively from a JSON tree at runtime — a material reason for choosing Drizzle over Prisma (§4).
- `POST /api/v1/playlists/:id/preview-rules` evaluates a rule tree against the library **without saving**, for live-preview while building a crate.

### 3.5 Waveform data — where it actually lives

**Decision: the full peak array is a sidecar binary file (`waveforms/…/<uuid>.lfpk`) under `LOCALFI_DATA_DIR`, referenced by `tracks.waveform_path`. Two small scalar summaries — `waveform_peak_count` and `waveform_avg_level` — live directly on the `tracks` row.**

This follows the file-storage rule ("not inside SQLite"): a peak array is inherently a per-track blob of file-like data, comparable in nature to cover art or the audio itself, not structured relational data — it belongs in the filesystem next to those. The two scalars are different in kind: small, genuinely queryable/sortable numbers (a rough loudness indicator useful for instant UI before the sidecar fetch resolves, or a future loudness-based sort/filter) — exactly what a DB column is for. Inlining the whole peak array as a DB blob would bloat the SQLite file with binary data that's never queried by SQL, only ever fetched whole and handed to the client.

**`.lfpk` binary format** (custom, intentionally simple — no parsing library needed on the read side):

```
offset  size  field
0       4     magic "LFPK"
4       1     format version (1)
5       1     encoding (0 = int8 min/max pairs)
6       2     reserved (0)
8       4     uint32 LE peak count
12      4     float32 LE duration (seconds), for standalone sanity-checking
16      N*2   N peaks, each: 1 signed byte (min), 1 signed byte (max), amplitude scaled to [-128,127]
```

Peak count is **fixed** (default 1600) regardless of track length — computed by dividing the decoded PCM sample stream into 1600 buckets and taking min/max per bucket. This keeps the transport-bar scrubber's visual density consistent whether a track is 90 seconds or 12 minutes, and bounds file size predictably (16 + 1600×2 ≈ 3.2 KB per track). Served as raw bytes (`Content-Type: application/octet-stream`) by its own endpoint; parsed client-side by a shared `lib/waveform/parse.ts` into a typed array.

### 3.6 Dedup / change-detection fingerprint

**Decision: `tracks.fingerprint = sha1(relativePath + '|' + fileSizeBytes + '|' + fileMtimeEpoch)`** — a fast composite key, not a full content hash. Computed from a single `fs.stat` per file on rescan, no file content read required (reading and hashing the full bytes of a large FLAC library on every rescan would be slow and defeats the point of a cheap, frequent rescan). `file_size_bytes` and `file_mtime` are also kept as their own columns so rescan logic can compare stat results directly.

This deliberately does **not** catch a file renamed/moved on disk outside the app — that looks like a delete (old row → `missing_since`) plus a fresh import. Accepted tradeoff, not a bug: catching true renames would require content hashing or filesystem move-event watching (not portable/reliable across all filesystems), disproportionate cost for the benefit.

**True duplicate detection** (same audio content under two different files) is a separate, heavier concern handled by the Health feature, not the per-scan fingerprint: a "probable duplicate" heuristic on `(normalized title, normalized primary artist, duration_seconds rounded to the nearest second)`, surfaced for user review/action. Full acoustic fingerprinting (Chromaprint/AcoustID-style) is out of scope this phase — slow, another native dependency, and really a metadata-enrichment-adjacent feature.

### 3.7 Import/scan jobs

```sql
CREATE TABLE import_jobs (
  id              INTEGER PRIMARY KEY,
  uuid            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL CHECK (type IN ('upload','scan')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','completed_with_errors','failed','cancelled')),
  total_files     INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  failed_files    INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT,
  finished_at     TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE import_job_files (
  id                INTEGER PRIMARY KEY,
  job_id            INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  staged_path       TEXT,
  track_id          INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','reading_tags','transcoding_waveform','saving','done','failed','duplicate_skipped')),
  error_message     TEXT,
  bytes_total       INTEGER,
  bytes_processed   INTEGER,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_import_job_files_job ON import_job_files(job_id);
```

`type='scan'` (library rescan for missing files / changes) reuses the exact same job machinery as `type='upload'` — same progress model, same UI. `import_jobs.type` is intentionally an open enum so `'spotify_import'`/`'ytdlp_import'` can be added later as pure additions (see Appendix).

On process startup, any job left in `running` from a previous crash is marked `failed` with a note, and anything in `staging/` older than 24h is swept. **No auto-resume of interrupted imports** — for a single-user local app, the cost of "user just re-drops the files" is far lower than the complexity of resumable multi-stage job recovery.

**Concurrency**: import processing runs through a small in-process worker pool (`p-queue` or a hand-rolled semaphore) — no external job-queue system. Decision: no Redis/BullMQ — this is one process, one user, no distributed workers. Default concurrency = `min(4, os.cpus().length)`, overridable via `LOCALFI_IMPORT_CONCURRENCY` (ffmpeg decode is CPU-heavy; uncapped concurrency would peg the machine on a big folder drop).

### 3.8 Playback / queue state

```sql
CREATE TABLE playback_state (
  session_key      TEXT PRIMARY KEY DEFAULT 'default',
  queue_json       TEXT NOT NULL,             -- ordered JSON array of track ids
  current_index    INTEGER NOT NULL DEFAULT 0,
  position_seconds REAL NOT NULL DEFAULT 0,
  is_playing       INTEGER NOT NULL DEFAULT 0,
  volume           REAL NOT NULL DEFAULT 1.0,
  repeat_mode      TEXT NOT NULL DEFAULT 'off' CHECK (repeat_mode IN ('off','all','one')),
  shuffle          INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);
```

**Why the queue is a JSON blob here but playlists are a normalized join table**: the queue is ephemeral, single-owner, and rewritten wholesale on essentially every interaction (skip, reorder, shuffle) — there's no need to address or query an individual queue entry independently. Playlists are persistent, individually addressable, and (eventually) shareable entities where row-level operations (add one track, move one track) matter. Different access patterns, different storage shape — a deliberate distinction, not an inconsistency.

`session_key` defaults to the constant `'default'` for the single-player phase-1 case, but is a real column (not a hardcoded singleton row with no key) specifically so multi-device/multi-tab state later (a second browser tab, eventually the Android app) is just "write more rows," not a schema change.

### 3.9 `settings`

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

General-purpose key/value escape hatch (e.g. `last_health_check_at`) — deliberately not over-specified now.

### 3.10 Dates, keys, general conventions

- All timestamps are `TEXT` in ISO 8601 UTC (SQLite has no native datetime type; ISO8601 strings sort correctly as text and are trivially portable).
- All boolean-shaped columns are `INTEGER` (0/1), per SQLite convention.
- All internal FKs use the fast `INTEGER PRIMARY KEY`; `uuid TEXT UNIQUE` is the externally-stable identifier where one is needed (tracks, albums, artists, playlists).
- Migrations run through `drizzle-kit` — the Drizzle TypeScript schema is the single source of truth; the SQL above is the conceptual shape it compiles to.

---

## 4. ORM / driver: Drizzle + `better-sqlite3`

**Decision: Drizzle ORM over `better-sqlite3`. Not Prisma. Not `node:sqlite`.**

- **`better-sqlite3` vs. `node:sqlite`**: `node:sqlite` (Node's built-in module) is still explicitly experimental — confirmed by running it directly (`node --version` → `v25.2.1`; `require('node:sqlite')` prints `ExperimentalWarning: SQLite is an experimental feature and might change at any time`). For an app meant to be relied on, "experimental, may change at any time" is a real risk to the entire data layer. `better-sqlite3`, by contrast, has years of production hardening and ships **prebuilt binaries** for common platform/ABI combinations (win32-x64 included) — on Windows this means `npm install` typically just downloads a compiled `.node` file, no Visual Studio Build Tools, no node-gyp, which is exactly the friction a native module would otherwise add. Mitigation for the edge case where no prebuild matches (very new Node release, unusual arch): pin a known-good Node LTS in `engines`/`.nvmrc`, and document the VS Build Tools fallback in the README's troubleshooting section. Revisit `node:sqlite` once it's actually marked stable.
- **Drizzle vs. Prisma**: the deciding factors are specific to this project: (1) a single-file SQLite DB, single process, no serverless/edge cold-start concerns — Drizzle's SQL-close, code-first schema is a natural fit for a schema this custom (fractional-indexing text keys, JSON rule columns, several `CHECK` constraints); (2) the smart-crate rule compiler (§3.4) needs to build a `WHERE` clause dynamically from a runtime JSON tree — Drizzle's expression-builder functions (`and`, `or`, `eq`, `gt`, …) compose naturally for that; Prisma's generated-client `where` object shape does not. `drizzle-kit` handles migrations against the SQLite file directly.

---

## 5. Tag extraction & writing

**Read: `music-metadata`. Write: `node-taglib-sharp`.** `music-metadata` is the most battle-tested read-path parser across MP3/FLAC/WAV/OGG/M4A/AAC edge cases, but is **read-only** — it cannot write tags. `node-taglib-sharp` (a maintained JS port of TagLib#) is used specifically for its write path (the metadata editor's save action). Two purpose-built libraries, each doing the thing it's actually best at, rather than one library doing everything adequately.

Tag-edit flow (`PATCH /api/v1/tracks/:id`): validate input → write to the physical file via `node-taglib-sharp` → update the DB row from the same values → re-run album/artist upsert logic (same fingerprint-based dedup as import, so renaming an album via the editor correctly regroups tracks) → respond with the updated resource. If the file write fails (e.g. read-only filesystem), the whole operation fails — the DB is never allowed to drift from the file (§3 principle).

---

## 6. Audio probing & waveform generation

**Decision: `ffmpeg` decode-to-PCM + hand-rolled Node bucketing. No `ffprobe`, no `audiowaveform`.**

- **`music-metadata` already provides duration, bitrate, sample rate, and codec** for all target formats at read time — this covers the bulk of what `ffprobe` would otherwise be asked to do, so a dedicated ffprobe dependency is unnecessary. ffprobe is not used in phase 1.
- **`ffmpeg`'s one job in this pipeline is decoding audio to raw PCM** (`ffmpeg -i <input> -f s16le -ac 1 -ar <rate> pipe:1`), for waveform peak generation. The Node process buckets the resulting samples into the fixed-1600-peak `.lfpk` format itself (§3.5) — this avoids a second native binary (`audiowaveform`) and a second parsing dependency for something the pipeline can do in a few dozen lines once it already has PCM in hand. `audiowaveform` remains a documented fallback if the hand-rolled bucketing ever proves to be a quality/performance bottleneck, but it is not the default.

**ffmpeg dependency strategy — require a system-installed `ffmpeg` on PATH**, matching the Jellyfin/Navidrome precedent. A startup health check (`GET /api/v1/health`, plus a log line at boot) shells out `ffmpeg -version`; if it's missing, the server still starts (so the UI can render a clear "install ffmpeg" message) but import/waveform generation is disabled with an actionable error rather than a cryptic subprocess failure. Rationale: requiring one well-known, often-already-installed system tool is more in keeping with "minimal footprint" than bundling a ~70–80MB static binary for a capability (PCM decode) many target users already have installed for other tools. **Documented alternative**: for a fully zero-setup experience, `ffmpeg-static` can be swapped in as the resolved binary path (same call sites — just point at `require('ffmpeg-static')` instead of `'ffmpeg'`) via a `LOCALFI_FFMPEG_PATH` config override, called out in the README as a one-line flip, not a separate code path.

---

## 7. API endpoint list

Conventions: all endpoints under `/api/v1/`. Success responses return the resource/collection directly; list endpoints wrap as `{ items, nextCursor }`; errors are `{ error: { code, message, details? } }` with the matching HTTP status (400 validation, 401 unauthorized, 404 not found, 409 conflict, 422 invalid rule schema, 500 server error). **Pagination is cursor-based (`limit` + opaque `cursor`), not offset-based** — the library changes interactively during imports/scans, and offset pagination visibly drifts (skipped/duplicated rows) when rows are inserted mid-scroll; a cursor built from `(sortValue, id)` doesn't have that problem.

**Import progress: SSE as primary, polling GET as a documented, first-class fallback.** This is a local single-user app on localhost, so a long-lived `text/event-stream` connection per active job is cheap and gives real-time per-file progress with no polling overhead — a clear win for the desktop UI. The plain polling GET is kept fully functional (not a vestige) because it's what a future mobile client, which may handle long-lived background connections poorly, should prefer by default.

| Method | Path | Purpose | Request | Response (brief) |
|---|---|---|---|---|
| GET | `/tracks` | Browse/filter/sort/paginate tracks | query: `q, format, lossless, artistId, albumId, genre, yearMin, yearMax, sort, limit, cursor` | `{ items: TrackSummary[], nextCursor }` |
| GET | `/tracks/:id` | Track detail | — | full `Track` + resolved artist/album + art/waveform URLs |
| PATCH | `/tracks/:id` | Edit tags (writes file + DB, §5) | partial tag fields | updated `Track` |
| DELETE | `/tracks/:id` | Remove from library (soft, moves file to `trash/`) | `?hard=true` for permanent purge | `204` |
| POST | `/tracks/:id/relink` | Point a missing track at a re-located file | `{ path }` | updated `Track` |
| GET | `/tracks/:id/stream` | Audio bytes, **HTTP Range required** | `Range` header; `?token=` (see §8) | `206 Partial Content`, audio bytes |
| GET | `/tracks/:id/waveform` | Precomputed peak sidecar | `?token=` | raw `.lfpk` bytes, `application/octet-stream` |
| GET | `/tracks/:id/cover` | Cover art (falls back to album art) | `?token=` | image bytes |
| GET | `/albums` | Browse albums | `q, artistId, year, sort, limit, cursor` | `{ items: AlbumSummary[], nextCursor }` |
| GET | `/albums/:id` | Album detail incl. ordered tracklist | — | `Album` + `tracks: TrackSummary[]` (disc/track order) |
| GET | `/albums/:id/cover` | Album art | `?token=` | image bytes |
| GET | `/artists` | Browse artists | `q, sort, limit, cursor` | `{ items: ArtistSummary[], nextCursor }` |
| GET | `/artists/:id` | Artist detail | — | `Artist` + `albums: AlbumSummary[]` |
| GET | `/playlists` | List playlists/crates | `type` | `{ items: PlaylistSummary[] }` |
| POST | `/playlists` | Create playlist or crate | `{ name, type, rulesJson? }` | `Playlist` |
| GET | `/playlists/:id` | Detail (manual: ordered tracks; smart: live-evaluated tracks) | — | `Playlist` + `tracks: TrackSummary[]` |
| PATCH | `/playlists/:id` | Rename/describe/update rules | partial fields incl. `rulesJson` | `Playlist` |
| DELETE | `/playlists/:id` | Delete playlist | — | `204` |
| POST | `/playlists/:id/tracks` | Add track to manual playlist | `{ trackId, afterPosition? }` | `PlaylistTrack` |
| PATCH | `/playlists/:id/tracks/:trackId` | Reorder (new fractional `position`) | `{ position }` | `PlaylistTrack` |
| DELETE | `/playlists/:id/tracks/:trackId` | Remove one entry from playlist | — | `204` |
| POST | `/playlists/:id/preview-rules` | Live-evaluate a rule tree without saving | `{ rulesJson }` | `{ items: TrackSummary[], count }` |
| POST | `/import` | Initiate an upload job (staged files → job) | multipart form / staged file refs | `ImportJob` |
| GET | `/import/jobs` | List recent jobs | `limit` | `{ items: ImportJob[] }` |
| GET | `/import/jobs/:id` | Job snapshot (polling) | — | `ImportJob` + `files: ImportJobFile[]` |
| GET | `/import/jobs/:id/events` | Job progress, SSE | — | `text/event-stream` of job/file updates |
| POST | `/import/jobs/:id/cancel` | Cancel a running job | — | `ImportJob` |
| POST | `/scan` | Trigger a library rescan (missing files / changes) | — | `ImportJob` (`type='scan'`) |
| GET | `/health` | Server health (ffmpeg found, DB ok, data dir writable) | — | `{ ffmpeg: bool, db: bool, dataDir: bool }` |
| GET | `/health/report` | Library health summary | — | `{ missingCount, duplicateGroupCount, pendingWaveformCount, … }` |
| GET | `/health/missing` | List of missing tracks | `limit, cursor` | `{ items: TrackSummary[] }` |
| GET | `/health/duplicates` | Probable duplicate groups | `limit, cursor` | `{ items: { tracks: TrackSummary[] }[] }` |
| GET | `/playback-state` | Current queue/position | `?sessionKey=default` | `PlaybackState` |
| PUT | `/playback-state` | Replace queue/position (debounced from client) | `PlaybackState` fields | `PlaybackState` |

---

## 8. Auth-stub middleware

**Mechanism: a thin, centralized gatekeeper in `proxy.ts` (Next.js 16's stable Node-runtime proxy entry point, replacing the deprecated Edge-only `middleware.ts`), backed by a shared `isAuthorized()` helper — enforcing via rewrite, not by returning a body directly.**

Next.js 16's `proxy.ts` runs on the Node.js runtime (so it can freely use `fs`, `crypto`, and other Node APIs to read a token file off disk — resolving the historical Edge-runtime conflict), but it has a hard, framework-level constraint: **it cannot return a response body (JSON/HTML), only redirect, rewrite, or modify headers.** Next's own current guidance is to keep real request-handling logic (auth checks that need to produce a JSON error, DB lookups, etc.) in Route Handlers, not in the proxy itself. The design below accounts for that constraint directly, rather than assuming `proxy.ts` can `return NextResponse.json({...}, { status: 401 })` (it cannot).

- **Location**: `proxy.ts` at the project root, with a matcher covering `/api/v1/:path*`. It calls a shared `lib/auth/verifyToken.ts::isAuthorized(request)`.
- **Token generation/storage**: on first run, the server generates `crypto.randomBytes(32).toString('hex')` and writes it to `LOCALFI_DATA_DIR/auth-token` (created once; subsequent boots read the existing file). `LOCALFI_AUTH_TOKEN` env var overrides the file if set (useful for scripting/dev/tests). The value is loaded once into an in-memory module constant at process start.
- **How it's checked**: `isAuthorized()` accepts either the `Authorization: Bearer <token>` header **or** a `?token=` query parameter, and compares against the loaded token. The query-param fallback exists specifically because native `<audio>`/`<img>` elements cannot attach custom headers — and switching those to `fetch()` + Blob URLs to preserve headers would break native HTTP Range handling, which is a hard requirement. So the streaming/waveform/cover endpoints (§7) accept `?token=`, matching the well-established pattern from Jellyfin/Plex/Navidrome's own API-key-in-URL handling of media byte-serving endpoints. All other endpoints are called via the app's own `fetch`-based API client, which always attaches the header.
- **Enforcement, correctly shaped around the `proxy.ts` body constraint**: on an unauthorized request, `proxy.ts` does **not** attempt to return a JSON body itself. Instead it **rewrites** the request to an internal `app/api/_unauthorized/route.ts` Route Handler, which — as an ordinary route handler, not a proxy — is free to return the actual `401 { error: { code: 'unauthorized', message } }` JSON body. On a successful check, `proxy.ts` calls `NextResponse.next()` and the request proceeds to its real route handler unmodified. This keeps enforcement centralized (no individual route handler has to remember to check auth — a common real-world source of security bugs) while staying inside what `proxy.ts` is actually allowed to do.
- **Defense-in-depth**: route handlers may still call the shared `isAuthorized()`/`requireAuth()` helper directly if they need to resolve identity or want a second check — but the proxy rewrite is the actual rejection point for unauthenticated traffic.
- **How the browser UI gets the token**: since frontend and backend are the same Next.js process, the root layout (a Server Component) reads `LOCALFI_DATA_DIR/auth-token` directly via `fs` (server-only, never shipped to the client bundle) and passes it into a client Provider as an initial prop via the server-rendered payload. The client stores it in the Zustand store (in-memory; re-supplied on every full navigation, so no `localStorage` persistence is needed in phase 1). `lib/api-client.ts` reads it from the store and attaches it to every request; a small `withAuthQuery(url)` helper appends `?token=` for the media-tag cases.
- **What changes later, without an API reshape**:
  - *Stage 1 (now)*: single static token, one implicit user, generated once.
  - *Stage 2 (LAN password)*: add `POST /api/v1/auth/login` accepting a password, issuing a real session token (stored server-side with expiry). `isAuthorized()`'s **shape** (`Authorization: Bearer` / `?token=`) doesn't change — only what it validates against changes internally. No route handler is touched, because none of them talk to auth directly; the proxy rewrite pattern above is unaffected.
  - *Stage 3 (real cloud auth)*: swap the validation backend again (e.g. validate a JWT issued by the cloud service). Same story — the wire contract every client (including the eventual Android app) already depends on stays stable across all three stages.

---

## 9. Design tokens → Tailwind

**Decision: CSS-custom-property theme swap, not Tailwind's `dark:` variant utility.** This is what Tailwind v4 itself recommends for token-based theming (config moved from `tailwind.config.js` into CSS via `@theme`), and it matches the shape these tokens already come in — named semantic values per theme, not a handful of one-off colors. Raw hex values live as CSS custom properties on theme-root selectors; Tailwind's `@theme` block maps semantic color names to those variables **by reference, not inlined**, so a runtime theme switch (toggling `data-theme` on `<html>`) instantly repaints every `bg-surf`/`text-t1`/etc. utility with no rebuild and no `dark:` prefix sprinkled through components — directly satisfying "named theme values, not raw hex scattered through components."

Token values below are sampled directly from the actual Claude Design canvas file (`Local-fi.dc.html`, the "Ultraviolet Dub" palette card), not estimated from the prose description.

```css
/* app/globals.css */
@import "tailwindcss";

:root[data-theme="dark"] {
  --lf-bg: #121016;      --lf-surf: #1A1720;    --lf-surf-2: #221E2A;
  --lf-line: #2E2939;
  --lf-t1: #EFEAF5;      --lf-t2: #A29BB0;      --lf-t3: #6A6478;   /* no distinct t4 in dark; falls back to t3 */
  --lf-acc: #8A5CF0;     --lf-acc-2: #A47BFF;   --lf-acc-text: #8A5CF0;   /* accText == acc in dark, not acc-2 */
  --lf-on-acc: #FFFFFF;
  --lf-playing: #C9A6FF;
  --lf-ok: #9BB4E8;      --lf-warn: #D6B45C;    --lf-err: #E0566E;
  --lf-glass: rgba(18,16,22,.87);
  --lf-tint: rgba(138,92,240,.13);
  --lf-ring: rgba(164,123,255,.12);
  --lf-glow-a: rgba(138,92,240,.32);
  --lf-glow-b: rgba(201,166,255,.18);
  --lf-art-shadow: 0 8px 20px rgba(14,10,24,.36);
  --lf-shadow: 0 18px 48px rgba(14,10,24,.42);
}

:root[data-theme="light"] {
  --lf-bg: #F7F5FB;      --lf-surf: #FFFFFF;    --lf-surf-2: #F0ECF8;
  --lf-line: #E4DFEE;
  --lf-t1: #1C1826;      --lf-t2: #665F78;      --lf-t3: #665F78;   --lf-t4: #A29BB0;
  --lf-acc: #7343DE;     --lf-acc-2: #6435C9;   --lf-acc-text: #6B3ACB;
  --lf-playing: #5B2FBF;
  --lf-ok: #3F5F94;      --lf-warn: #7E6320;    --lf-err: #B23A50;
  --lf-shadow: 0 18px 48px rgba(14,10,24,.18);
  /* --lf-glass / --lf-tint / --lf-ring / --lf-glow-a / --lf-glow-b are intentionally NOT
     redefined here — they cascade/inherit from the dark block above by design (confirmed
     against the source file: the light-mode override never redefines them either). The
     Now Playing glass backdrop keeps the same warm purple glow in both themes. */
}

@theme {
  --color-bg: var(--lf-bg);
  --color-surf: var(--lf-surf);
  --color-surf-2: var(--lf-surf-2);
  --color-line: var(--lf-line);
  --color-t1: var(--lf-t1);
  --color-t2: var(--lf-t2);
  --color-t3: var(--lf-t3);
  --color-acc: var(--lf-acc);
  --color-acc-2: var(--lf-acc-2);
  --color-playing: var(--lf-playing);
  --color-ok: var(--lf-ok);
  --color-warn: var(--lf-warn);
  --color-err: var(--lf-err);

  --font-sans: var(--font-inter);
  --font-mono: var(--font-jetbrains-mono);
  --font-serif: var(--font-fraunces);
}
```

Usage in components: `bg-surf`, `text-t1`, `border-line`, `text-acc`, `bg-playing/20`, `shadow-[var(--lf-shadow)]` — never raw hex or ad hoc `dark:` overrides.

**Semantic rules (enforced by convention/code review, not a build-time lint in phase 1)**: `acc`/`acc-2` only on actual action affordances (Import, Play, primary confirm buttons); `playing` reserved for sound-related state (waveform fill, currently-playing row tint, live indicators); `line` for all static-surface 1px hairlines, no drop shadows on static elements; `shadow` (warm-tinted) used only on the transport bar, modals, and toasts; glassmorphism (`backdrop-filter: blur(48px) saturate(140%)`) used exactly once, on the full-screen Now Playing backdrop, using `--lf-glow-a`/`--lf-glow-b`/`--lf-glass` in a radial-gradient.

**Fonts: self-hosted via `next/font/google`, not the design file's live Google Fonts `<link>`.** Deliberate deviation, justified by the product's own "zero dependency on the outside internet" ethos — that should extend to not needing network access just to render the UI's type correctly. `next/font/google` downloads and self-hosts the font files at build time; there is no runtime call to Google's CDN.

```ts
// app/fonts.ts
import { Inter, JetBrains_Mono, Fraunces } from "next/font/google";

export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });
export const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
```

Inter for all UI text (`font-sans`, the default), JetBrains Mono for raw/monospace data (duration, bitrate, file paths, counts, timestamps — apply `font-mono` explicitly on those elements), Fraunces reserved for empty states, album titles in the detail view, and the Now Playing screen only (`font-serif`, applied narrowly, not as a general heading font).

**Shell dimensions**: left nav rail 240px expanded (72px collapse is a nice-to-have, not required for milestone 1); right context rail 360px, `position: absolute` overlay (not a flex sibling — it must not reflow main content); bottom transport bar 88px, `position: fixed`/pinned under all columns. The 1440×920 mockup is a design-canvas preview frame, not a target viewport — the real shell is fluid (min-width guards on the rails, main content area flexes).

---

## Appendix: cheap insurance for explicitly out-of-scope phases

None of the following is built in this phase. Flagged here so phase-0 schema/API choices don't accidentally paint a later phase into a corner.

**Metadata web-lookup (MusicBrainz/Discogs/cover-art-archive):**
- When that phase starts, add nullable `mbid` (or similar) columns to `artists`/`albums`/`tracks` (and an `identifiers` join table if multiple providers are wanted later) — a trivial additive migration. Not added now to avoid unused columns for a feature not being built.
- `tracks.raw_tags_json` (already in the phase-0 schema) exists specifically so re-matching against a web source later doesn't require re-reading every file from disk.

**Spotify/yt-dlp import:**
- `import_jobs.type` is already an open enum (`'upload' | 'scan'`) — adding `'spotify_import'`/`'ytdlp_import'` later is a pure addition, no redesign.
- Files arriving via yt-dlp will often lack clean embedded tags. The phase-0 import pipeline (M2) should already tolerate missing/partial tags gracefully (fall back to filename parsing) — good practice regardless, no extra work needed now, just don't regress it later.
- When built, expect to want a nullable `source_url`/`source_provider` column on `tracks` for provenance — not added now.

**Android app (second API client):**
- The API is already versioned (`/api/v1/`) and returns plain JSON — the main real risk is the auth bootstrap (currently a same-machine file read). The Stage 2 LAN-password flow already designed in §8 (`POST /api/v1/auth/login`) is exactly the mechanism a phone on the same LAN would use — no extra design work needed when that phase starts.
- SSE (M2's import progress) is fine for a browser but some mobile HTTP stacks/OS background policies handle long-lived SSE poorly — keep the polling GET fallback (already part of M2) genuinely functional, not a vestigial alias, since the Android client should default to it.
- Cursor-based pagination and sort-field names (already the phase-0 design) are part of the wire contract a second client will depend on — avoid churning them casually after this phase ships.

**Cloud/social service (own auth/Postgres/deployment):**
- The `uuid` columns already added to `tracks`/`albums`/`artists`/`playlists` in phase 0 are exactly what a future sync protocol needs as stable cross-system identifiers — no extra work.
- `playback_state.session_key` (already a real column, not a hardcoded singleton) already anticipates multi-device state — no extra work.
- When multi-user/sharing concepts arrive, expect to add a nullable `owner_id` to `playlists` (and possibly `tracks`) at that time — flagged as the one additive migration to expect; not added now, since there is no user concept locally yet and an unused `owner_id` column today would just be confusing.
- Keep the local SQLite schema and the future cloud Postgres schema deliberately decoupled — a sync layer should translate between them; don't contort the local-first schema to pre-fit a future multi-tenant cloud shape. Philosophy note, not a code change.

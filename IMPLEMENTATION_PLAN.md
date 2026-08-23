# IMPLEMENTATION_PLAN.md — local-fi (Phase 0: Library Server + Desktop Web Player)

Scope: backend (API + SQLite + file storage + waveform/tag processing) and desktop web player UI only.
Not in this plan: mobile app, metadata web-lookup, Spotify/yt-dlp import, cloud/social service.

Each milestone is meant to be reviewable/shippable independently and states what's concretely demoable at the end.

## Milestone sequencing rationale

The user's suggested order is followed closely, with one deliberate change: **the riskiest technical bets (subprocess-based ffmpeg decode, streaming SSE progress, filesystem I/O under concurrency) are validated in M2, immediately after the thinnest possible backend skeleton (M1) — before any real UI investment beyond the shell.** If ffmpeg subprocess handling or the waveform pipeline turns out to be harder than expected, that's discovered in milestone 2, not milestone 8. Playback (M4–M5) comes before the deeper library-browsing surface (M6 detail views) because "does audio actually play, with working seek" is the core value proposition of a music player and should be proven early, not saved for later. Crates, command palette, tag editor, and health are progressively more "feature complete / polish" and are safely sequenced last, since each depends on machinery (upsert/dedup logic, the browse API, the player) built in earlier milestones.

---

### M0 — Scaffold + theme

Set up `create-next-app` (Next.js 16, App Router, TypeScript), Tailwind v4 wired per ARCHITECTURE.md §9 (CSS-variable theme tokens, `@theme` mapping, `data-theme` toggle), self-hosted fonts via `next/font/google`. Build the static app shell: 240px nav rail, main content area, 360px right-rail overlay slot (empty), 88px fixed transport bar (empty), theme toggle. No data, no API routes yet.

**Dependencies to install**: `next@16 react@19 react-dom@19 typescript tailwindcss@4 @tailwindcss/postcss zustand`.

**Demoable**: `npm run dev` shows the themed, empty shell; toggling light/dark instantly repaints via the CSS-variable swap; resizing the window proves the layout is fluid, not the 1440px mockup frame.

---

### M1 — Backend skeleton: DB schema, migrations, file storage, auth stub, health

Add Drizzle schema (ARCHITECTURE.md §3, all tables) + `drizzle-kit` migration setup. Implement `LOCALFI_DATA_DIR` bootstrap (creates `originals/ artwork/ waveforms/ staging/ trash/ tmp/`, generates `auth-token` on first run). Implement `proxy.ts` + `lib/auth/verifyToken.ts` + the internal `app/api/_unauthorized/route.ts` rewrite target (§8's corrected pattern — proxy.ts checks the token and rewrites to this route on failure; it never returns a body itself). Implement `GET /api/v1/health` (DB reachable, data dir writable, `ffmpeg -version` check). No track-facing endpoints yet.

**Dependencies**: `drizzle-orm drizzle-kit better-sqlite3 @types/better-sqlite3 zod`.

**Demoable**: server boots, `data/library.db` and `data/auth-token` exist on disk; `curl -H "Authorization: Bearer <token>" localhost:3000/api/v1/health` returns `{ ffmpeg: true, db: true, dataDir: true }`; an unauthenticated request returns `401` (via the proxy rewrite → `_unauthorized` route, confirming the corrected auth mechanism actually works end-to-end, not just in theory). This is a real, testable backend skeleton before any UI touches it.

---

### M2 — Import/upload pipeline (backend) + Ingest tray (UI)

The highest-risk milestone — built early on purpose. Backend: staging → tag extraction (`music-metadata`) → artist/album upsert-with-dedup (fingerprint-based, §3.3/3.6) → ffmpeg PCM decode → waveform bucketing → `.lfpk` write → atomic move into `originals/` → `import_jobs`/`import_job_files` progress tracking → SSE + polling endpoints (§7, §3.7's concurrency queue). UI: the Ingest tray drop-zone, per-file rows (mini waveform placeholder, status text, progress bar, format, size), wired to the SSE stream.

**Dependencies**: `music-metadata p-queue` (or a hand-rolled semaphore); confirm system `ffmpeg` is on PATH.

**Demoable**: drag a real folder of mixed MP3/FLAC/WAV files onto the Ingest tray; watch genuine per-file progress (not a fake spinner) to completion; confirm files land under `originals/`, `.lfpk` sidecars exist under `waveforms/`, and rows exist in `tracks`/`albums`/`artists` (inspectable via a raw SQLite browser at this stage, no browse UI yet). Deliberately drop a corrupt/unsupported file into the same batch and confirm it's reported as `failed` on its own row without blocking the rest of the batch (partial-failure requirement).

---

### M3 — Library browse API + Grid/List views

Backend: `GET /tracks`, `/albums`, `/artists` with filter/sort/cursor-pagination (§7). Frontend: TanStack Query wiring through a typed `lib/api-client.ts` (data-fetching logic lives outside page components, per the brief's requirement), Grid view (album cards, color-coded format badge overlay top-left), List view (dense rows: #/Title/Album/Format/Rate/Time), the Grid/List toggle.

**Dependencies**: `@tanstack/react-query`.

**Demoable**: browse the library imported in M2 in both views; sort by date added/title/duration; filter to lossless-only; format badges render with the right token colors (§9 semantic color rules).

---

### M4 — Streaming endpoint + transport bar

Backend: `GET /tracks/:id/stream` with real HTTP Range support (§7's Range implementation — `fs.createReadStream({start,end})`, `206`, `Content-Range`, `Accept-Ranges`). Frontend: persistent transport bar mounted in the root layout (survives route navigation), native `<audio>` element, the waveform-bar seek scrubber rendered from the `.lfpk` peak data (not decoded client-side — fetched once via `GET /tracks/:id/waveform` and parsed by `lib/waveform/parse.ts`), hover-preview time tooltip.

**Demoable**: click a track anywhere in the library, it plays; the scrubber shows a real waveform (not a flat progress bar); dragging the scrubber seeks correctly; the browser Network tab shows `206 Partial Content` responses, confirming Range support actually works, not just "playback happens to work in this particular browser."

---

### M5 — Full-screen Now Playing + Queue drawer + persisted playback state

Backend: `GET`/`PUT /playback-state`. Frontend: right-side Queue drawer (360px overlay, Now Playing summary + reorderable Up Next list using the same fractional-indexing scheme as playlists), full-screen Now Playing overlay (glass backdrop — the one and only use of `backdrop-filter` in the app, large art, waveform scrubber, transport controls, Up Next toggle, radial glow from `--lf-glow-a`/`--lf-glow-b`). Playback state (queue, index, position) debounce-writes to `playback_state` on change.

**Demoable**: open Now Playing full-screen; reorder Up Next by drag; reload the browser tab — queue contents and playback position survive the reload (read from `playback_state`), proving persistence actually works, not just in-memory state that happens to look right until refresh.

---

### M6 — Album/Artist detail views

Album detail: hero art, play/queue/edit-tags actions (edit-tags entry point wired to open the modal shell; full save behavior lands in M9), numbered tracklist ordered by disc/track number. Artist detail: artist's albums, correctly reflecting the `album_artists`/`track_artists` many-to-many join (a compilation or multi-artist album displays all credited artists, not just the denormalized primary one).

**Demoable**: click into an album, see the hero + correctly ordered tracklist; click through to an artist page; verify a compilation album (multiple album artists) renders all credited artists correctly, not just one.

---

### M7 — Crates (manual playlists + smart crates)

Backend: playlist CRUD, track add/reorder/remove (`playlist_tracks`, fractional `position`), `rules_json` CRUD, the rule compiler (`lib/crates/compileRules.ts`) turning a JSON rule tree into a Drizzle `WHERE`, `POST /playlists/:id/preview-rules`. Frontend: Crates view with manual reorderable rows (drag handle) and the smart-rule chip strip builder (e.g. "Format is lossless AND Added within 30 days"), live-previewing matched tracks via the preview endpoint before saving.

**Demoable**: create a manual crate, drag-reorder its tracks, reload, order persists; create a smart crate with a two-condition rule, see it correctly populated; import a new lossless file via the Ingest tray and confirm the smart crate picks it up automatically without any manual re-save (proving rules are evaluated live at query time, not cached membership).

---

### M8 — Command palette (⌘K) + search

Reuses the M3 browse endpoints with a `q` param and small result limits; groups results by type (Tracks/Albums/Artists/Crates) in the palette UI; keyboard-navigable; keyboard-shortcut hints and actions for play/queue/edit-tags/reveal-in-folder (the last one is a desktop-only affordance — implemented via a small local endpoint that shells out to the OS file explorer, gated behind being served on `localhost`).

**Demoable**: ⌘K, type a partial title, grouped results appear across categories; arrow-key to a result and hit the keyboard shortcut to queue it without leaving the palette; "reveal in folder" opens the actual OS file explorer at the track's location.

---

### M9 — Metadata editor

Backend: `PATCH /tracks/:id` fully wired to `node-taglib-sharp` (file write) → DB update → album/artist re-upsert (§5 flow). Frontend: the tag-editor modal (standard form over the taggable fields — title, artist, album, album artist, track/disc number, year, genre), save/cancel, validation errors surfaced inline.

**Dependencies**: `node-taglib-sharp`.

**Demoable**: edit a track's title/artist/album via the modal; reopen the file in an external tag tool (or re-trigger a scan) and confirm the embedded tag actually changed on disk, not just in the DB (proving the file-is-source-of-truth principle from ARCHITECTURE.md §3 holds); rename an album via the editor and confirm the track correctly regroups under the renamed album rather than creating an orphaned duplicate album row.

---

### M10 — Library health

Backend: `GET /health/report`, `/health/missing`, `/health/duplicates`; the rescan (`POST /scan`) marks vanished files `missing_since` rather than deleting them; probable-duplicate heuristic (§3.6) surfaces candidate groups. Frontend: Settings & Health view — stat tiles (missing count, duplicate group count, pending-waveform count), per-issue rows with an action button (Relink / Remove missing entry / Review duplicate group).

**Demoable**: move or delete a file on disk outside the app entirely; trigger a rescan; see it flagged as missing on the Health page with a working Relink/Remove action; confirm two near-identical imports (same title/artist/duration, different filenames) are surfaced as a probable-duplicate group.

---

## Appendix: 5-minute decisions now that would save real pain later (flagged, not built)

These are for the phases explicitly out of scope this round. None of them are implemented in this plan — they're additive migrations/notes to make when that phase actually starts, listed here so the phase-0 implementer doesn't accidentally paint them into a corner. (Duplicated from ARCHITECTURE.md's appendix for convenience while working milestone-by-milestone.)

**Metadata web-lookup**: add nullable `mbid`-style columns as an additive migration when that phase starts; `tracks.raw_tags_json` (already in phase 0) avoids re-reading files from disk to re-match later.

**Spotify/yt-dlp import**: `import_jobs.type` is already an open enum — new job types are pure additions; keep the M2 import pipeline tolerant of missing/partial tags (filename-parsing fallback), since yt-dlp-sourced files often lack clean tags; expect a nullable `source_url`/`source_provider` column later, not added now.

**Android app**: the API is already versioned and JSON-only; the Stage 2 LAN-password auth flow (§8) is exactly what a same-LAN phone client would use; keep M2's polling-GET import-progress fallback genuinely functional, since mobile HTTP stacks handle long-lived SSE poorly; don't casually churn cursor-pagination/sort-field names after this phase ships.

**Cloud/social service**: the `uuid` columns and the real `playback_state.session_key` column (both already in phase 0) are exactly what a future sync protocol and multi-device state need; expect one additive nullable `owner_id` column on `playlists` when multi-user arrives; keep the local SQLite schema and any future cloud Postgres schema deliberately decoupled, translated by a sync layer rather than pre-fit to each other.

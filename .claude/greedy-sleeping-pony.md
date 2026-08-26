# Standalone (No-PC) Deploy of the Mobile PWA

## Context

Every phase of the mobile PWA built so far (pairing, copy-to-phone, copy-to-PC, local import, offline playback) works and has been verified end-to-end — but there's exactly one place any of that code is served from: a specific user's own PC. A phone has to reach that PC's Next.js server at least once just to download the app's HTML/JS/manifest before any of it can run. The user has called this out directly as "a big barrier for users" and wants a version of the app installable from a public URL, independent of any single PC, that works completely standalone for local-only use (import files on the phone, play them, nothing else) — with PC interaction remaining exactly what it is today: optional, on-demand, only when the user wants to move music to/from a PC over LAN. Cross-network/internet pairing was explicitly ruled out in an earlier discussion — this stays LAN-only; what's changing is only how the *app itself* gets onto the phone in the first place.

This is a distribution problem, not a missing-feature problem — nearly everything needed already exists and works. The gap is that the current app is a single, inseparable Next.js project mixing a real backend (SQLite, ffmpeg, `proxy.ts` auth middleware, ~40 API routes) with the mobile UI, and Next's static-export mode (needed to host on a plain static file host with no server at all) is all-or-nothing for a project — it can't selectively export some routes while keeping others dynamic. So this becomes a second, separate deployable app, reusing the existing mobile code rather than rewriting it.

**A real bug was found and confirmed by reading the code, not assumed** — this is the single most important finding and changes the shape of the plan: the existing pairing flow (`components/pairing/PairView.tsx`, `QrScanner.tsx`) and every API client function (`lib/api-client.ts`, `lib/api/*Client.ts`) assume same-origin requests, because in the current LAN-mobile model the phone loads the page *from* the PC, so "same origin" already means "the PC." Once the app is served from a different origin (a static host), every relative `fetch("/api/v1/...")` call would hit that static host instead of the PC, and `PairView.tsx:36`'s `serverUrl: window.location.origin` would permanently store the wrong address. Pairing needs real code changes, not just reuse — see Phase 4.

## Guiding decision: reuse code via cross-directory imports, not a monorepo restructure

The repo has zero monorepo tooling today (no `packages/`, no workspace config, single flat `package.json`, no CI, no test suite) and is effectively solo-maintained. Physically moving dozens of files into a `packages/shared/` workspace package and rewriting every import path is the "more correct" long-term shape, but it's a large, all-at-once, high-risk diff to a currently-working app with no automated tests to catch a broken path.

**Chosen approach**: `apps/standalone/` is a new, separate Next.js project (own `package.json`/`next.config.ts`) whose `tsconfig.json` sets `"@/*": ["../../*"]` — mirroring the root app's own `"@/*": ["./*"]` — so every reused file's existing `@/lib/...`/`@/components/...` imports resolve **unchanged**, with zero files moved and zero import-path rewrites in the existing app. This needs one cheap, fast validation before committing to it (Phase 1). Revisit a real workspace/shared-package restructure only if this later proves to be a real drift-management burden (e.g., shared-file changes routinely need re-verifying both apps, or a third consumer of the shared code shows up) — not before.

---

## Phase 1 — Spike: confirm cross-directory static export actually bundles cleanly

Before building anything real: a throwaway `apps/standalone/` with a minimal `package.json` (`next`, `react`, `react-dom` only), `next.config.ts` (`output: "export"`), and the `@/*` → `../../*` path alias. A single page importing one trivial cross-directory file (`@/lib/format/track`'s `formatDuration`) plus one that pulls in an external dependency declared only in the *root* `package.json` (e.g. something from `idb`) — this checks both "does outside-root resolution work at all" and "do shared files' own transitive dependencies resolve from the standalone project." Run `next build`, inspect `out/` for a clean, correctly-inlined bundle.

**Confirms the approach**: clean build, no special/experimental Turbopack flags needed, shared code's own dependencies resolve fine. **Rules it out** (fall back to a real workspace restructure immediately, before further standalone work): build errors on the outside-root import, needing undocumented flags, or an unresolved external reference in the output.

## Phase 2 — Scaffold the standalone app

`apps/standalone/` — `next.config.ts`: `output: "export"`, `images: { unoptimized: true }` (defensive; the codebase's actual convention is plain `<img>` with an eslint-disable comment everywhere already, so this is likely a no-op — confirm during the build). Omit `allowedDevOrigins`/`proxyClientMaxBodySize` entirely — both are LAN-dev-server- and `proxy.ts`-specific, meaningless here.

`package.json`: only what reused code needs at runtime — `idb`, `music-metadata`, `jsqr`, `zustand`, `@tanstack/react-query`, `next`, `react`, `react-dom`. Verify via a real build (not inspection) that nothing pulls in `better-sqlite3`, `drizzle-orm`, `node-taglib-sharp`, `qrcode`, `chokidar`, `yazl` transitively — `lib/audio/*` is the set most worth double-checking, since it's less obviously client-only at a glance than the `lib/offline/*` layer.

## Phase 3 — Minimal standalone root layout

Replace `app/layout.tsx`'s unconditional `getAuthToken()` call (Node `fs`, reads `LOCALFI_DATA_DIR` — cannot exist in a static export) with nothing — no server-side token read, and drop `AuthTokenProvider` entirely (confirmed harmless: `lib/api/http.ts`'s `currentToken()` already prefers the device-store token over the static one, and there's never a static token to seed in this app).

Keep: `QueryProvider`, `ServiceWorkerRegister`, `SettingsProvider`, `HotkeysProvider`, `PlaybackStateProvider`, `BottomTabBar`, `MiniPlayer`, `NowPlayingSheet`, `QueueSheet`. Verify before including: `FolderImportModal`/`IngestTray`/`TrackTagEditorHost` — these may be desktop/backend-only; only keep if genuinely reachable from the standalone nav. Drop: `NavRail`, `RightRail`, `TransportBar`, `NowPlayingOverlay`, `CommandPalette` is kept but gated (see Phase 5).

## Phase 4 — Fix the pairing flow for cross-origin operation (real new logic, not pure reuse)

1. `lib/api/http.ts` — add `apiBase()` (`useDeviceStore.getState().device?.serverUrl ?? ""`) and `apiUrl(path)` (`` `${apiBase()}${path}` ``) next to the existing `currentToken()` chokepoint. Empty string preserves today's same-origin behavior exactly for the existing LAN app — this is a shared-code change, behavior-preserving there, load-bearing here.
2. Route every relative `fetch("/api/v1/...")` call site through `apiUrl()`: `lib/api-client.ts`, `lib/api/tracksClient.ts`, `lib/api/playlistsClient.ts`, `lib/api/homeClient.ts`, `lib/api/playbackClient.ts`.
3. `QrScanner.tsx`'s scan payload needs to also surface `url.origin`, not just the extracted code (`extractCodeFromScan` currently discards it).
4. `PairView.tsx` needs a standalone-aware path: POST `completePairing` against the *scanned* origin directly (not `apiUrl`, since no device is paired yet), and store that scanned origin via `setPaired` — not `window.location.origin`, which in this app is the static host, not the PC.
5. **Keep manual code entry working, don't drop it** — add a required "Server address" field (e.g. `192.168.1.42:3000`) to the standalone pairing screen specifically, since a typed code alone carries no address in a cross-origin context. Manual entry exists precisely because camera/QR scanning doesn't always work; dropping it for standalone would remove an accessibility fallback the original design treated as equally first-class. (The existing LAN app's `/pair` page is unaffected — same-origin there, no new field needed.)

## Phase 5 — Make every reused page gracefully "backend-optional"

Confirmed call sites that currently fire an unconditional query regardless of pairing state:
- `MobileLibraryView.tsx`'s `MobileSongsList`/`MobileArtistsList`/`MobileCratesList` — add `enabled: isPaired` (`useDeviceStore((s) => s.device !== null)`, the same pattern `MobileDownloadedList` already uses for its "Upload to PC" button) plus a distinct "not paired to a PC yet" empty state — not the existing "No songs yet" message, which would be actively misleading here.
- `CommandPalette.tsx`'s four queries (tracks/albums/artists/crates via `fetchTracks`/`fetchAlbums`/`fetchArtists`/`fetchPlaylists`) — same `enabled` gating, otherwise they fire, fail, and only show empty after React Query's default retry/backoff delay.
- `lib/store/player.ts`'s `hydrate()`/`schedulePersist()`/`persistPosition()` (all call `lib/api/playbackClient.ts`) — skip the network call entirely when `!isPaired` rather than letting it fail into a caught-but-noisy state on every play/pause/seek.

**Home** (`HomeView.tsx` → `fetchHomeStats`, zero offline fallback) — drop from the standalone build's nav; a weekly-listening-stats dashboard has no meaning with no synced play history. Standalone `app/page.tsx` renders the Library view directly instead.

**Library segment default**: `MobileLibraryView.tsx`'s default segment becomes `"downloaded"` (the only one guaranteed to have content with zero PC interaction). Drop the `"folders"` segment from `SEGMENTS` for this build — it's a desktop-watched-folder concept that doesn't apply here.

**Search**: keep wired to `CommandPalette` with the gating above, rather than building new client-side offline search — that's a genuinely new capability (no existing full-text search over `lib/offline/db.ts`), out of scope for this pass.

## Phase 6 — Routes and nav

Keep: `/` (Library/Downloaded default), `/library`, `/import` (`MobileLocalImportSection.tsx` — already fully backend-free), `/settings` (`SettingsView.tsx` — reusable wholesale; `MobileDevicesSection.tsx` already degrades gracefully), `/pair` (Phase 4's rewritten version).

Drop entirely — and confirmed structurally necessary, not just a scope trim: `/albums/[id]`, `/artists/[id]`, `/crates/[id]`, `/crates/[id]/dj`, `/health`, `/crates`, `/trash`. These are dynamic `[id]` routes requiring `generateStaticParams()` to enumerate every possible id at build time, which is impossible here (ids only exist on whichever PC a given install eventually pairs with) — a hard incompatibility with static export, not a preference. Where `MobileLibraryView.tsx`/`MobileDownloadedList` currently link into these (artist rows, crate rows), point them at the paired PC's own already-working pages instead: `href={`${device.serverUrl}/artists/${id}`}` as an external link, deferring anything beyond the standalone app's own scope to the real desktop-rendered page rather than reimplementing a CRUD-heavy detail view.

`BottomTabBar.tsx`'s tabs become: Library (root), Import, Search (gated), Settings — Home dropped per Phase 5.

## Phase 7 — Deployment

No CI exists yet — this is new, not a modification. **Recommend Cloudflare Pages**: serves from domain root (no `basePath` juggling), free custom-domain HTTPS, generous build minutes, simple git-integration or `wrangler-action` deploy. GitHub Pages is a reasonable fallback if staying entirely in GitHub tooling matters, but needs `basePath`/`assetPrefix` set for a project-pages URL and a `.nojekyll` file in `out/` (Jekyll ignores `_next/`-prefixed paths by default — an easy, deploy-breaking miss). Vercel's free tier is the weakest default — its terms are scoped to non-commercial use, a soft mismatch for a self-hosted tool others might deploy commercially.

New `.github/workflows/deploy-standalone.yml`, triggered on push to main, path-filtered to `apps/standalone/**` plus the shared paths it imports from (avoid deploying on unrelated desktop-app-only commits): `npm ci && npm run build` inside `apps/standalone/`, then deploy `apps/standalone/out/`.

## Verification (per phase, matching the rigor already used across this whole project — real browsers, real network conditions, not just "it builds")

- **Phase 1**: build-output inspection only (grep `out/` for correctly-inlined shared code).
- **Phase 2/3**: real browser loading the static build served locally (`npx serve out`) — confirm hydration succeeds with zero console errors and **zero network calls to any `/api/v1/*` path fire on initial load** (a real assertion, not just visual inspection).
- **Phase 4**: two real browser contexts — one on a LAN address (the existing desktop app), one loading the standalone build. Inject a scanned payload directly into the `QrScanner.onScan` code path (Playwright can't drive a real camera) and assert `useDeviceStore`'s persisted `serverUrl` equals the PC's LAN origin, not the standalone host's — then confirm a real `fetchTracks()` resolves against that LAN origin.
- **Phase 5**: network fully disabled (matching how offline playback was verified for the existing mobile app) — confirm gated empty states render instead of hangs, and that local import + fully offline playback work with zero network at all. This is the core "zero PC, ever" claim and deserves the most scrutiny.
- **Phase 7**: install from the real deployed HTTPS URL. Worth specifically testing: the in-app camera QR scanner has never functioned over the existing LAN app's plain HTTP (`getUserMedia` needs a secure context) — confirm whether it actually starts working for the first time now that the standalone app is served over real HTTPS, a genuine new capability this deployment model unlocks.

## Critical files

- `lib/api/http.ts` — gains `apiBase()`/`apiUrl()`, the chokepoint that makes cross-origin pairing work at all.
- `components/pairing/PairView.tsx`, `QrScanner.tsx` — the confirmed-broken-as-is pairing flow, needs real fixes not just reuse.
- `components/library/MobileLibraryView.tsx`, `components/shell/CommandPalette.tsx`, `lib/store/player.ts` — the backend-optional gating.
- `app/layout.tsx` — where the standalone layout forks from the existing one.
- `next.config.ts` (root, for reference) / new `apps/standalone/next.config.ts`, `tsconfig.json` — the static-export + cross-directory-import mechanics.

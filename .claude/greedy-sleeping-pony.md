# PWA Mobile Client for local-fi

## Context

local-fi runs as a self-hosted Node.js server (SQLite/Drizzle, ffmpeg, node-taglib-sharp) plus a desktop-only Next.js browser client — architecturally like Navidrome/Jellyfin, not a hosted SaaS app. [ARCHITECTURE.md](../../../../d/Github/local-fi/ARCHITECTURE.md) already anticipated a second client ("Android app") via the versioned `/api/v1/` JSON API, but nothing mobile exists yet — no responsive layout, no PWA scaffolding, no auth beyond a single static bearer token.

Through discussion we settled on a specific mobile model, not the originally-floated "thin client to a PC server" nor a "fully standalone re-implementation":

1. **"Copy to phone" / "copy to PC"**, not continuous background sync — the user explicitly copies tracks/crates between devices when both are reachable, then the phone plays fully offline afterward.
2. **Local-import fallback** — if a user never gets the PC server running, they can still import files directly on the phone into a phone-only library.
3. **Tag editing is out of scope for mobile** (read-only parsing for phone-imported files only).
4. **QR-code pairing** is the linking + auth mechanism: the PC displays a QR code (LAN address + short-lived code); scanning it both tells the phone where the server is and authenticates it — solving "how does the phone find the PC" and "auth is needed once the server is reachable beyond localhost" in one step. Same-Wi-Fi/LAN only for v1; cross-network (Tailscale/tunnel) is explicitly deferred.
5. Crate *authoring* stays desktop-only; mobile browses/plays crates copied from the PC.

A design handoff (claude.ai/design project `835ca454-2792-4b9d-aca7-833453da0686`, `Local-fi.dc.html`) supplies static iOS mobile screens (390×844) plus a desktop pairing modal, all using the *same* CSS custom-property token system already live in `app/globals.css` — no new design tokens needed. The design was updated mid-planning to add the pairing flow explicitly (see Phase B) — its own on-screen copy independently confirms the LAN-only v1 scope already assumed here: *"Both devices must be on the same Wi‑Fi network. Access from outside the LAN — VPN or tunnel — is not part of this version."* The 5-tab mobile bar (Home/Library/Import/Search/Settings) has no dedicated Crates tab — resolved by placing Crates as a 4th segment in the Library tab's existing Albums/Artists/Folders control, consistent with the app's established IA. Flag this resolution for the user to correct if wrong.

**Open item to confirm during/after Phase A**: whether DJ mode (tempo/key/pitch) belongs in the mobile nav at all. It's desktop-only today (BPM/key analysis is server-side via ffmpeg), the design's mobile screens don't include it, and wiring it for offline mobile use (Phase E) may not be worth the effort if it's never exposed on mobile. Default assumption: **not included in mobile v1.**

---

## Guiding constraints (apply throughout)

- **Reuse over reinvention.** Every phase leads with what already exists and treats new code as the minimum glue to bridge mobile onto it.
- **`lib/store/auth.ts` + `lib/api/http.ts` are the auth chokepoint.** `authHeaders()`/`withAuthQuery()` (`lib/api/http.ts`) both read `useAuthStore.getState().token` — a single in-memory static token. Both device-token auth (Phase B) and offline mode (Phase E) extend this chokepoint, not the ~30 call sites that use it.
- **The audio-engine seam is two lines.** `assignTrack()` in `components/shell/usePlaybackEngine.ts:41` (`const url = streamUrl(track.id)`) and the equivalent line in `components/crates/dj/useDjPlaybackEngine.ts`. Phase E makes resolution offline-aware here, not rewrite the hooks.
- **One `<audio>` graph.** `usePlaybackEngine()` must still be called from exactly one place; mobile UI components (`MiniPlayer`, `NowPlayingSheet`) are presentational consumers of `usePlayerStore`, not separate callers — avoids two competing `AudioContext` graphs.

---

## Phase A — PWA shell & mobile navigation (live/online only)

Goal: a phone-width browser gets an installable, navigable 5-tab mobile UI that plays tracks live from the existing API — mobile skin over the current backend, no new server logic except one small stats endpoint.

**New files**
- `app/manifest.ts` — Next 16 native manifest (`display: "standalone"`, icons, theme colors from the existing dark-violet palette hex).
- `public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png` — asset generation, not code; needs a design input.
- `app/sw.ts` (or per Serwist's wiring) + `next.config.ts` wrapped with `withSerwist()` — app-shell precache only. **Do not cache `/api/v1/*` here** — that's Phase C/E's OPFS-backed cache, a separate concern from generic SW `CacheStorage`.
- `components/mobile/MobileShell.tsx`, `BottomTabBar.tsx` (5 tabs: Home/Library/Import/Search/Settings), `MiniPlayer.tsx` (64px docked, 92px above tab bar), `NowPlayingSheet.tsx` (model on `components/shell/NowPlayingOverlay.tsx`, reuse its children — `WaveformScrubber`, `UpNextList`, `PlayerIcons`), `EqSheet.tsx` (reuse `EqualizerPopover.tsx`'s EQ state/logic, reflowed), `QueueSheet.tsx` (reuse `UpNextList.tsx`'s logic).
- `app/(mobile)/home/page.tsx`, `library/page.tsx` (Albums/Artists/Folders/**Crates** segments), `album/[id]/page.tsx`, `onboarding/page.tsx` (paired/unpaired branch point from the start; Phase D wires the CTA).
- `app/api/v1/stats/week/route.ts` — new: weekly listening-hours/lossless-%/plays-by-day aggregates for the Home tab (only genuinely new server route in this phase).

**Modified**
- `app/layout.tsx` — branch desktop vs. mobile shell via a **viewport-conditional client component** (Tailwind `md:hidden`/`hidden md:flex`), not a separate route-group layout: the design reuses the same tokens with no styling reason to fork, and it keeps the single-`<audio>`-graph invariant intact. Keep all providers (`QueryProvider`, `AuthTokenProvider`, `SettingsProvider`, etc.) shared. Render inactive heavy shells as `null` (not just CSS-hidden), matching `NowPlayingOverlay`'s existing pattern, to avoid double data-fetching.
- `package.json` — add `serwist`/`@serwist/next` (verify current compatibility with Next 16 specifically — a hand-rolled SW is the fallback if support lags).

**Verification**: `next dev` on the PC, open from a phone (or DevTools device emulation at 390px) on the same LAN; confirm all 5 tabs navigate, Library grid shows real albums/artists/crates from the live API, tapping a track plays through the mini-player, Now Playing sheet transport controls work, EQ sheet fader changes are audible (proves it's wired to the real `PlaybackEqualizer`, not a dead copy), and "Add to Home Screen" produces a working standalone install.

---

## Phase B — Pairing / auth extension

Goal: a phone scans a QR shown on the PC (or types a short code) and becomes durably authenticated, without ever typing an IP or the static token.

**Confirmed design (read directly from the updated `Local-fi.dc.html`, not assumed)**:
- **Desktop**: a `☐ Pair a phone` item sits in the nav rail directly above "Settings & health" (a status dot next to it flips to the paired device's name once paired — not nested inside Settings). Clicking it opens a "Devices" modal: QR code on the left; on the right, "Server address" (LAN URL + a "LAN" badge), "Pairing code" shown as a human-typeable string like `4K7Q‑91TB` with a live countdown ("expires in 2:41") and a "New code" regenerate button, and copy stating *"One scan carries both the address and the code, so the phone finds this machine and authenticates in one step"* plus the LAN-only/no-VPN notice quoted above. Below: a "Paired devices" list — status dot, name, IP, last-seen, storage used (e.g. "640 MB cached"), "Unpair."
- **Mobile**: a dedicated "Pair with a computer" screen — headline "Point at the QR code" (Inter, not Fraunces, per the established rule), subtext "Open local‑fi on your PC → Devices," a live camera viewfinder with a corner-bracket reticle and a "Looking for a local‑fi server…" status pill, and — critically — a built-in, equally first-class **"Enter code instead"** card: 8 individual character boxes for the same human-typeable code, with "Same Wi‑Fi only · code expires in 2:41."

This resolves the earlier open question about QR-delivery mechanism: the product itself is designed around **one code that works two ways** (scanned or typed), not a URL-based OS-camera-app handoff. Build the plan around that.

**New files**
- `lib/db/schema.ts` additions — `devices` table (`uuid`/`token`, `name`, `pairedAt`, `lastSeenAt`, `revokedAt`) and a separate short-lived `pairingSessions` table (`code` — the human-typeable string, e.g. `4K7Q-91TB`, `expiresAt`, `consumedAt`) — two tables, mirroring the `import_jobs`-produces-a-result pattern, not overloaded onto the plain `settings` key/value table.
- `app/api/v1/pairing/start/route.ts` (PC calls, static-token-gated: generates the code + expiry + QR payload), `pairing/status/route.ts` (PC polls for completion, to flip the nav dot/modal to "paired"), `pairing/complete/route.ts` (phone calls with the code — whether obtained by scan or manual typing, same endpoint either way: validates it, mints a `devices` row + token, marks the session consumed — **must be reachable without existing auth**, chicken-and-egg problem).
- `lib/pairing/qr.ts` — `os.networkInterfaces()` LAN-IP detection (skip loopback/internal, handle multi-NIC) + QR payload encoding (LAN URL + code together, per the design's own framing) + generation (`qrcode` npm package for a data-URL PNG/SVG).
- Desktop: `components/shell/PairDeviceNavItem.tsx` (the nav-rail button + status dot) + `components/shell/PairingModal.tsx` (QR, address, code, countdown, "New code," paired-devices list with Unpair) — a standalone nav-level feature, not folded into `app/settings/page.tsx`.
- Mobile: `app/(mobile)/pair/page.tsx` + `components/mobile/pairing/QrScanner.tsx` (in-app camera viewfinder — see risk below) + `components/mobile/pairing/CodeEntry.tsx` (the 8-box manual entry, **ship this fully functional regardless of the camera path's status** — it has no secure-context dependency and is explicitly the design's built-in fallback, not an afterthought).
- `lib/store/device.ts` — new **localStorage-persisted** Zustand store (`serverUrl`, `deviceToken`, `deviceName`, `pairedAt`) — unlike `lib/store/auth.ts`'s in-memory-only static token, a paired phone must survive restarts.

**Modified**
- `lib/auth/verifyToken.ts` — extend `isAuthorized()` additively: static-token check first (fast path, no DB hit, byte-identical desktop behavior), then a `devices` table lookup fallback.
- `proxy.ts` — exclude `pairing/complete` (and `pairing/start`'s QR-image sub-resource if it ends up unauthenticated) from the blanket `/api/v1/:path*` auth matcher — only that path, not a general weakening.
- `lib/api/http.ts` — `authHeaders()`/`withAuthQuery()` prefer `lib/store/device.ts`'s token when present, fall back to `useAuthStore`'s static token — the single chokepoint change that makes every existing API call "just work" for a paired phone.
- `components/shell/NavRail.tsx` — add the `PairDeviceNavItem` above the existing "Settings & health" button, matching the design's placement exactly.

**Risk to elevate — this is now a harder blocker than earlier drafts assumed.** The confirmed mobile design depicts a *live in-app camera viewfinder*, which requires `getUserMedia`, which requires a secure context. A plain LAN address like `http://192.168.1.42:3000` is **not** a secure context in any standard browser (unlike `localhost`, which is exempt) — so the camera-scan half of this screen will simply fail to get camera access as designed, over plain HTTP. Two ways through, neither trivial, and this plan does not pick one for you:
1. **Local TLS** — self-sign a cert for the server's LAN IP/hostname and have the user trust it once per device (real scope addition: cert generation/rotation, a one-time "install this certificate" step with non-trivial UX on iOS specifically).
2. **Ship manual code entry as the real primary path for v1**, with the camera viewfinder either omitted or shown but gracefully degrading to "camera unavailable — enter the code below" when `getUserMedia` rejects — the design already treats code entry as equally first-class, so this isn't a UX downgrade so much as leaning on the fallback the product already designed for.
**Recommendation: option 2 for v1**, revisit local TLS only if manual entry proves too friction-heavy in practice. Flag this choice explicitly for the user before Phase B implementation starts.

**Verification**: PC nav → "Pair a phone" opens the modal with a QR and a real LAN IP (test on actual Wi-Fi, not localhost, to catch multi-NIC filtering bugs e.g. VPN adapters), code + countdown render, "New code" issues a fresh one. From a second physical device on the same Wi-Fi, complete pairing via manual code entry (the guaranteed-to-work path) and confirm the desktop modal flips to "paired — <name>" within one poll, the phone can call an authenticated endpoint using only the device token, and revoking from the desktop list causes the phone's next request to 401. Separately, test the camera viewfinder path on whichever resolution (TLS or graceful-degrade) was chosen.

---

## Phase C — Copy-to-phone (PC → phone)

Goal: from a paired phone, tap "Copy to phone" on a crate and end up with its tracks/covers/waveforms durably in OPFS, browsable and (per Phase E) playable offline.

**Storage decision — spike first, don't lock in blind**: OPFS for binary blobs (audio/covers/`.lfpk` waveforms) is a clear choice. For structured metadata (tracks/playlists/playlistTracks), the instinct to mirror `lib/db/schema.ts` via `wa-sqlite` (WASM SQLite + a Drizzle sqlite-wasm driver) is real engineering weight (bundle size, WASM load time, less-battle-tested Drizzle dialect support) for what's by definition a small offline subset. **Do a short spike comparing `wa-sqlite` vs. plain IndexedDB (via `idb`) before committing** — IndexedDB with a thin hand-written query layer, field-named consistently with the server schema, is very plausibly sufficient and simpler.

**New files**
- `lib/offline/db.ts` (client DB init, whichever storage wins the spike), `lib/offline/opfs.ts` (`writeTrackBlob`/`readTrackBlob`/`writeCover`/`writeWaveform`, plus `navigator.storage.estimate()` surfaced before large copies).
- `lib/offline/copyToPhone.ts` — orchestration: fetch crate metadata + track list, then **per track**: `GET /api/v1/tracks/:id/stream` (audio), cover URL, `GET /api/v1/tracks/:id/waveform` — write all three to OPFS, write rows to `lib/offline/db.ts` tagged `source: 'synced'`.
- `lib/store/offlineCopy.ts` — progress state (bytes copied/total) for a progress UI.
- `components/mobile/crates/CopyToPhoneButton.tsx`, `app/(mobile)/crate/[id]/page.tsx` (mobile crate detail, structurally like album detail — not explicitly in Phase A's list, add it here).
- `components/mobile/crates/CopyProgressView.tsx` — the confirmed "crate copied" status screen: crate art/title header ("Crate · on this phone"), a "Copy complete" card showing total size ("640 MB in OPFS"), a progress bar, and three explicit checkmarks — **tracks / covers / waveforms** — as separate completion states, plus a per-track list each with its own size + checkmark, and a persistent "Offline · playing from local storage" footer pill once fully cached. This confirms (independently of the earlier design decision) that the copy must track tracks/covers/waveforms as three distinct progress states, not one opaque blob — shape `lib/store/offlineCopy.ts`'s progress state accordingly (per-track, per-asset-type booleans, not just a byte counter).
- A "Downloaded" view/filter on the Library tab, sourced entirely from `lib/offline/db.ts` — no network required.

**Key decision — bulk primitive**: `GET /api/v1/playlists/:id/export` (`lib/crates/exportPlaylist.ts`) was checked directly — **confirmed audio-file-only** (no cover, no waveform sidecar in the zip), so it cannot be the sole pull mechanism regardless. **Use per-track fetching as the primary path** (better progress/resumability/partial-failure UX for a possibly multi-minute phone operation); keep the zip-export route in reserve only if per-track request overhead proves a bottleneck for very large crates.

**Risks to flag, not silently resolve**:
- **iOS Safari OPFS eviction behavior is the single biggest platform risk in this plan.** Historically eviction-prone for non-installed PWA storage; installed/standalone PWAs fare better but exact current-iOS behavior needs live-device verification, not doc assumption. **Must be spiked on real iPhone hardware, installed as a home-screen PWA, before this phase is considered done** — a silently-evicted "offline" library is a severe trust failure for a feature pitched exactly on that promise.
- No cross-browser Background Sync guarantee — a copy backgrounded mid-transfer may simply stop. Known v1 limitation (stay foregrounded during copy), not solved here.

**Verification**: pair a phone, copy a small (2-3 track) crate, then fully disable Wi-Fi and confirm it's browsable offline with correct metadata (playback is Phase E's bar). Separately, install to an iPhone home screen and re-run, then check behavior after several days to sanity-check eviction risk.

---

## Phase D — Copy-to-PC (phone → PC) + local-import fallback

**D1 — Copy-to-PC (paired phone → PC).** Reuse `POST /api/v1/import` (`app/api/v1/import/route.ts`) completely unmodified — a paired phone is just another caller using a device-token header instead of the static token, which works automatically once Phase B lands. New: `components/mobile/upload/UploadToPcButton.tsx` (builds `FormData` from OPFS blobs via `readTrackBlob`, POSTs using the same batching contract) — **check `components/ingest/FolderImportModal.tsx` during implementation and reuse its batching/progress shape** rather than re-deriving it, since desktop folder-import already implements this client-side contract. Only offer this action on `source: 'local'` tracks (uploading a track that was itself copied *from* the PC is a pointless round-trip).

**D2 — Local-import fallback (phone-only library, no PC needed).** New: `lib/offline/localImport.ts` (file picker → OPFS write → client-side tag parse → `tracks` row tagged `source: 'local'`). Tag parsing: `music-metadata` is already a dependency (used server-side) — **verify it has a browser-safe build** (no Node-only APIs) before assuming reuse; otherwise needs bundler config or a lighter fallback lib. Waveform generation with no ffmpeg available: `AudioContext.decodeAudioData()` + manual peak-bucketing into the same `.lfpk` format `lib/waveform/parse.ts` already reads, done in a new `lib/offline/waveformWorker.ts` (Web Worker — large-file PCM decode blocks the main thread otherwise). **Flag, don't solve**: FLAC decode support varies by browser (weak/absent on older Safari) — degrade gracefully to a plain progress-bar scrubber and `waveformStatus: 'failed'` rather than blocking import; check whether `usePlayerStore`'s waveform slice already has this fallback path (desktop tracks can already be waveform-pending). Wire this into `app/(mobile)/onboarding/page.tsx`'s "Choose a folder"/"Import music" CTA from Phase A.

**Risks**: File System Access API's directory picker is Chromium-only — need the `<input type="file" multiple webkitdirectory>` fallback for Safari/iOS. Client-side waveform-gen performance on lower-end phones is untested — needs real-device timing, not just desktop-browser testing.

**Verification**: D1 — from a paired phone with a `source: 'local'` track, trigger "Upload to PC," confirm it appears in the PC's real library via the existing desktop Import job UI (pipeline untouched, so this is purely a visibility check). D2 — on an unpaired phone, import 2-3 files including one FLAC, confirm correct tags and (for non-FLAC) a waveform.

---

## Phase E — Offline playback wiring

Goal: the two audio-engine seams resolve tracks from OPFS first, falling back to (or exclusively using, if unpaired) the network stream.

**New**: `lib/offline/resolvePlaybackSrc.ts` — `resolvePlaybackSrc(track): Promise<string>`, checks `lib/offline/db.ts`/`opfs.ts` for a cached blob, returns `URL.createObjectURL(blob)` if present, else falls back to `streamUrl(track.id)`. Needs explicit Blob-URL lifecycle management (`revokeObjectURL` on track change) — a new failure class this codebase hasn't had to handle before, since `streamUrl()` today returns a stable string with no cleanup obligation. Equivalent resolver for waveforms, extending `lib/waveform/parse.ts`'s `fetchWaveform()` (low risk — `parseWaveform(buffer)` already takes raw bytes regardless of source).

**Modified**: `components/shell/usePlaybackEngine.ts:41` — `assignTrack()`'s `streamUrl(track.id)` becomes `await resolvePlaybackSrc(track)` (minimal signature change; already inside an async flow). `useDjPlaybackEngine.ts` — same pattern, but **skip entirely if DJ mode isn't in the mobile nav** (per the open item in Context — confirm before doing this work). `lib/store/player.ts` — redirect its waveform-loading call site to the new offline-aware resolver.

**Verification**: with Wi-Fi disabled and a Phase-C-copied crate present, play a track fully through, confirm crossfade between two offline tracks works (exercises the dual-deck path against Blob URLs), waveform scrubber renders and seeks correctly, EQ sheet still audibly affects playback. Re-enable Wi-Fi and play an *uncopied* track to confirm the network fallback still works — a regression check against Phase A's baseline.

---

## Phase F — explicitly deferred (do not design against yet)

Cross-network access beyond LAN (Tailscale/tunnel — would replace Phase B's LAN-only pairing assumption), tag editing on mobile, crate authoring/smart-rule building on mobile, background/automatic sync (Phases C/D are one-shot user-triggered by design). Phase B's device-token model and Phase C's `source: 'synced'` tagging are both compatible with layering automatic sync on later without rearchitecting.

---

## Critical files

- `lib/store/auth.ts` + `lib/api/http.ts` — the auth chokepoint Phase B/E extend.
- `components/shell/usePlaybackEngine.ts` — the primary audio-engine seam (Phase E) and the invariant (single `<audio>` graph) Phase A's mobile shell must not violate.
- `lib/db/schema.ts` — source of truth for Phase B's new `devices`/`pairingSessions` tables and the shape Phase C's client-side schema mirrors.
- `app/api/v1/import/route.ts` and `lib/crates/exportPlaylist.ts` — existing server primitives Phases C/D build on, confirmed by direct read (export is audio-only, import pipeline is reusable as-is for phone uploads).
- `app/layout.tsx` — where Phase A's desktop/mobile shell fork happens; every provider must stay shared.

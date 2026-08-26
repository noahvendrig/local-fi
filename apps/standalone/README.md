# local-fi standalone

A static-export build of the mobile PWA, installable from a public URL instead of a PC's own
LAN address. Reuses the existing mobile UI/offline code from the root app via cross-directory
imports (`@/*` → `../../*` in `tsconfig.json`) — no files are duplicated or moved.

Local-only use (import files on the phone, play them) works with zero PC ever involved.
Pairing with a PC to browse/stream its library or copy crates is optional, on-demand, and
LAN-only — the same as the existing mobile view, just reachable from a different origin now
(see `components/pairing/PairView.tsx` and `lib/api/http.ts`'s `apiUrl()`).

## Develop

```bash
cd apps/standalone
npm install
npm run dev
```

## Build

```bash
npm run build   # writes apps/standalone/out/
npx serve out   # preview the static output locally
```

## Deploy

`.github/workflows/deploy-standalone.yml` builds and deploys to Cloudflare Pages on push to
`main` (path-filtered — see the workflow's own comment). It needs, once:

1. A Cloudflare Pages project named `local-fi-standalone` (or update the `--project-name` in
   the workflow to match whatever you create).
2. Repo secrets `CLOUDFLARE_API_TOKEN` (Pages edit permission) and `CLOUDFLARE_ACCOUNT_ID`.

Until those are set, the workflow will fail at the deploy step — the build itself still runs
and validates on every push.

## A note on CORS

Pairing and every subsequent API call this app makes cross the browser's origin boundary
(this app's static host → whatever LAN address the PC is on), which requires the PC's own
`proxy.ts` to send CORS headers — added there for exactly this. The existing LAN mobile/desktop
view is same-origin and unaffected.

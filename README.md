This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Spotify playlist import

Importing a public Spotify playlist (Import page → "Import from Spotify") finds each
track on YouTube and downloads it via a bundled Python backend (`python-backend/`,
forked from a standalone yt-dlp downloader). Set up once:

```bash
cd python-backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # .venv/bin/pip on macOS/Linux
```

You'll also need `ffmpeg`, `yt-dlp` and a JS runtime (`deno`) on `PATH` — the same
prerequisites yt-downloader-ui documents, since this backend uses the same
`yt_dlp` library under the hood.

Then register a free Spotify app at [developer.spotify.com](https://developer.spotify.com/dashboard),
add `http://127.0.0.1:3000/api/v1/spotify/callback` under its **Redirect URIs**, and add
its credentials to `.env`:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

Spotify no longer allows reading a playlist's tracks with just those app credentials —
even for your own public playlists — so there's a one-time login: open **Settings →
Spotify → Connect Spotify** and grant access. That's it from then on; the app refreshes
its own access token in the background. (Running on something other than
`127.0.0.1:3000`? Set `SPOTIFY_REDIRECT_URI` to match, and register that exact URI in
the dashboard too — Spotify requires an exact match.)

`npm run dev` starts the Python backend automatically (see `instrumentation.ts`) —
it's spawned on `127.0.0.1:8765` by default. Override the port with
`LOCALFI_PYTHON_BACKEND_PORT`, or the interpreter with `LOCALFI_PYTHON_PATH` if you
don't want the `.venv` picked up automatically. `GET /api/v1/health` reports whether
it's reachable.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

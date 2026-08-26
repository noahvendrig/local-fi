import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // The codebase's actual convention is plain <img> with an eslint-disable comment everywhere
  // already (confirmed while reading the reused components), so next/image's optimizer is never
  // in play — this is defensive only, and a static export couldn't run the optimizer anyway.
  images: { unoptimized: true },
  // Silences Next's "inferred workspace root" warning: with the shared code living one level up
  // (../../lib, ../../components) and a lockfile at both this directory and the repo root, the
  // root would otherwise need guessing. Pointing it at the actual monorepo root also matches
  // where Turbopack needs to resolve shared files' own dependencies from (see Phase 1 spike).
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // Baked into the client bundle at build time — the single flag every standalone-aware branch
  // in the reused shared code (PairView, MobileLibraryView, CommandPalette, ...) checks. Never
  // set in the root app's own next.config.ts, so it's always undefined/falsy there.
  env: {
    NEXT_PUBLIC_STANDALONE: "true",
  },
};

export default nextConfig;

import type { MetadataRoute } from "next";

// Required for `output: "export"` — a static export can't serve a dynamically-computed route,
// so this pins it to build time. Not needed in the root app's manifest.ts, which isn't exported.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "local-fi",
    short_name: "local-fi",
    description: "A local-first music library and player.",
    start_url: "/",
    display: "standalone",
    background_color: "#121016",
    theme_color: "#121016",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

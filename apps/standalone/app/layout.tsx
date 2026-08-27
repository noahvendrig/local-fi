import type { Metadata } from "next";
import Script from "next/script";
import { inter, jetbrainsMono, fraunces } from "@/app/fonts";
import { ServiceWorkerRegister } from "@/components/shell/ServiceWorkerRegister";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { PlaybackEngineMount } from "@/components/shell/PlaybackEngineMount";
import { MediaSessionMount } from "@/components/shell/MediaSessionMount";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";
import { MiniPlayer } from "@/components/mobile/MiniPlayer";
import { NowPlayingSheet } from "@/components/mobile/NowPlayingSheet";
import { QueueSheet } from "@/components/mobile/QueueSheet";
import { TrackTagEditorHost } from "@/components/library/TrackTagEditorHost";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { PlaybackStateProvider } from "@/components/providers/PlaybackStateProvider";
import { SettingsProvider } from "@/components/providers/SettingsProvider";
import { HotkeysProvider } from "@/components/providers/HotkeysProvider";
import { PALETTE_IDS } from "@/lib/theme/palettes";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "local-fi",
  description: "A local-first music library and player — standalone.",
};

// Same theme-init script as the root app's layout (app/layout.tsx) — kept in sync by hand since
// this is a separate Next project with no shared layout to inherit it from. Runs before
// hydration so the correct tokens are on first paint, same as there.
const THEME_INIT_SCRIPT = `(function(){try{var s={};try{s=JSON.parse(localStorage.getItem('lf-settings')||'{}')||{}}catch(e){}var t=s.theme||localStorage.getItem('lf-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}var palettes={${PALETTE_IDS.map((id) => `${id}:1`).join(",")}};var p=palettes[s.palette]?s.palette:'violet';var d=s.density==='compact'?'compact':'comfortable';var m=s.reducedMotion?'reduce':'full';var r=document.documentElement;r.setAttribute('data-theme',t);r.setAttribute('data-palette',p);r.setAttribute('data-density',d);r.setAttribute('data-motion',m);}catch(e){document.documentElement.setAttribute('data-theme','dark');document.documentElement.setAttribute('data-palette','violet');}})();`;

// No getAuthToken()/AuthTokenProvider here — that reads LOCALFI_DATA_DIR off the filesystem,
// which can't exist in a static export, and there's no static token to seed anyway: a paired
// device's token (lib/store/device.ts, persisted to localStorage) is the only credential this
// app ever has (lib/api/http.ts's currentToken() already prefers it over the static one).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-theme="dark"
      data-palette="violet"
      data-density="comfortable"
      data-motion="full"
      className={`${inter.variable} ${jetbrainsMono.variable} ${fraunces.variable} h-full`}
    >
      <head>
        <Script
          id="lf-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="flex h-full flex-col font-sans antialiased" suppressHydrationWarning>
        <QueryProvider>
          <ServiceWorkerRegister />
          <SettingsProvider />
          <MediaSessionMount />
          <HotkeysProvider />
          <PlaybackStateProvider />
          <PlaybackEngineMount />
          <main className="flex-1 overflow-y-auto pb-[84px]">{children}</main>
          <BottomTabBar />
          <MiniPlayer />
          <NowPlayingSheet />
          <QueueSheet />
          <CommandPalette />
          <TrackTagEditorHost />
        </QueryProvider>
      </body>
    </html>
  );
}

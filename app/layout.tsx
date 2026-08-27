import type { Metadata } from "next";
import Script from "next/script";
import { inter, jetbrainsMono, fraunces } from "./fonts";
import { NavRail } from "@/components/shell/NavRail";
import { RightRail } from "@/components/shell/RightRail";
import { TransportBar } from "@/components/shell/TransportBar";
import { NowPlayingOverlay } from "@/components/shell/NowPlayingOverlay";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ServiceWorkerRegister } from "@/components/shell/ServiceWorkerRegister";
import { MediaSessionMount } from "@/components/shell/MediaSessionMount";
import { BottomTabBar } from "@/components/mobile/BottomTabBar";
import { MiniPlayer } from "@/components/mobile/MiniPlayer";
import { NowPlayingSheet } from "@/components/mobile/NowPlayingSheet";
import { QueueSheet } from "@/components/mobile/QueueSheet";
import { AuthTokenProvider } from "@/components/auth/AuthTokenProvider";
import { FolderImportModal } from "@/components/ingest/FolderImportModal";
import { IngestTray } from "@/components/ingest/IngestTray";
import { TrackTagEditorHost } from "@/components/library/TrackTagEditorHost";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { PlaybackStateProvider } from "@/components/providers/PlaybackStateProvider";
import { SettingsProvider } from "@/components/providers/SettingsProvider";
import { HotkeysProvider } from "@/components/providers/HotkeysProvider";
import { getAuthToken } from "@/lib/auth/token";
import { PALETTE_IDS } from "@/lib/theme/palettes";
import "./globals.css";

export const metadata: Metadata = {
  title: "local-fi",
  description: "A local-first music library and player.",
};

// Runs before hydration to set data-theme / palette / density from localStorage
// (or system preference for theme) so the correct tokens are on first paint.
const THEME_INIT_SCRIPT = `(function(){try{var s={};try{s=JSON.parse(localStorage.getItem('lf-settings')||'{}')||{}}catch(e){}var t=s.theme||localStorage.getItem('lf-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}var palettes={${PALETTE_IDS.map((id) => `${id}:1`).join(",")}};var p=palettes[s.palette]?s.palette:'violet';var d=s.density==='compact'?'compact':'comfortable';var m=s.reducedMotion?'reduce':'full';var r=document.documentElement;r.setAttribute('data-theme',t);r.setAttribute('data-palette',p);r.setAttribute('data-density',d);r.setAttribute('data-motion',m);}catch(e){document.documentElement.setAttribute('data-theme','dark');document.documentElement.setAttribute('data-palette','violet');}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  const token = getAuthToken();

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
          <AuthTokenProvider token={token} />
          <SettingsProvider />
          <MediaSessionMount />
          <HotkeysProvider />
          <PlaybackStateProvider />
          <div className="flex flex-1 overflow-hidden pb-[84px] md:pb-[88px]">
            <NavRail />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
          <RightRail />
          <TransportBar />
          <NowPlayingOverlay />
          <BottomTabBar />
          <MiniPlayer />
          <NowPlayingSheet />
          <QueueSheet />
          <IngestTray />
          <FolderImportModal />
          <CommandPalette />
          <TrackTagEditorHost />
        </QueryProvider>
      </body>
    </html>
  );
}

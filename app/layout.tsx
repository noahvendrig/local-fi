import type { Metadata } from "next";
import Script from "next/script";
import { inter, jetbrainsMono, fraunces } from "./fonts";
import { NavRail } from "@/components/shell/NavRail";
import { RightRail } from "@/components/shell/RightRail";
import { TransportBar } from "@/components/shell/TransportBar";
import { NowPlayingOverlay } from "@/components/shell/NowPlayingOverlay";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { AuthTokenProvider } from "@/components/auth/AuthTokenProvider";
import { IngestTray } from "@/components/ingest/IngestTray";
import { TrackTagEditorHost } from "@/components/library/TrackTagEditorHost";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { PlaybackStateProvider } from "@/components/providers/PlaybackStateProvider";
import { getAuthToken } from "@/lib/auth/token";
import "./globals.css";

export const metadata: Metadata = {
  title: "local-fi",
  description: "A local-first music library and player.",
};

// Runs before hydration to set data-theme from localStorage (or system preference)
// so the correct token set is already applied on first paint — no flash of the wrong theme.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('lf-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  const token = getAuthToken();

  return (
    <html
      lang="en"
      suppressHydrationWarning
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
          <AuthTokenProvider token={token} />
          <PlaybackStateProvider />
          <div className="flex flex-1 overflow-hidden pb-[88px]">
            <NavRail />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
          <RightRail />
          <TransportBar />
          <NowPlayingOverlay />
          <IngestTray />
          <CommandPalette />
          <TrackTagEditorHost />
        </QueryProvider>
      </body>
    </html>
  );
}

"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useCommandPaletteStore } from "@/lib/store/commandPalette";
import { useIngestStore } from "@/lib/store/ingest";

const NAV_ITEMS = [
  { label: "Library", icon: LibraryIcon, href: "/", enabled: true },
  { label: "Crates", icon: CratesIcon, href: "/crates", enabled: true },
  { label: "Health", icon: HealthIcon, href: "/health", enabled: true },
] as const;

export function NavRail() {
  const openIngestTray = useIngestStore((s) => s.open);
  const openCommandPalette = useCommandPaletteStore((s) => s.open);

  return (
    <nav className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surf">
      <div className="flex items-center gap-2 px-5 py-6">
        <span className="h-6 w-6 rounded-full bg-acc" aria-hidden />
        <span className="font-serif text-lg text-t1">local-fi</span>
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={openIngestTray}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-acc px-3 py-2 text-sm font-medium text-[var(--lf-on-acc)] hover:bg-acc-2"
        >
          <ImportIcon />
          Import
        </button>
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-t2 hover:bg-surf-2 hover:text-t1"
        >
          <SearchIcon />
          <span className="flex-1 text-left">Search</span>
          <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-t3">⌘K</span>
        </button>
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ label, icon: Icon, href, enabled }) => (
          <li key={label}>
            {enabled ? (
              <Link
                href={href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-t1 bg-[var(--lf-tint)]"
              >
                <Icon />
                {label}
              </Link>
            ) : (
              <span
                aria-disabled
                title="Coming soon"
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-t3"
              >
                <Icon />
                {label}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-line px-5 py-4">
        <span className="text-xs text-t3">Theme</span>
        <ThemeToggle />
      </div>
    </nav>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function CratesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="18" height="4" rx="1" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 3" />
    </svg>
  );
}

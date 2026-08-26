"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCommandPaletteStore } from "@/lib/store/commandPalette";

const TAB_ITEMS = [
  { label: "Home", icon: HomeIcon, href: "/", match: (path: string) => path === "/" },
  {
    label: "Library",
    icon: LibraryIcon,
    href: "/library",
    match: (path: string) => path.startsWith("/library") || path.startsWith("/albums") || path.startsWith("/artists") || path.startsWith("/crates"),
  },
  { label: "Import", icon: ImportIcon, href: "/import", match: (path: string) => path.startsWith("/import") },
] as const;

// Fixed 5-tab bottom bar for the mobile shell (design board 1c, m2 "Library grid" frame).
// Search opens the existing ⌘K command palette rather than navigating — same store both
// desktop (CommandPalette.tsx) and this button drive, so results/behavior stay identical.
export function BottomTabBar() {
  const pathname = usePathname();
  const openCommandPalette = useCommandPaletteStore((s) => s.open);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[84px] items-start gap-0 border-t border-line bg-surf pt-3 md:hidden">
      {TAB_ITEMS.map(({ label, icon: Icon, href, match }) => {
        const isActive = match(pathname);
        return (
          <Link
            key={label}
            href={href}
            className={`flex flex-1 flex-col items-center gap-1.5 text-center ${isActive ? "text-acc-text" : "text-t3"}`}
          >
            <Icon />
            <span className="text-[11px] font-medium tracking-[0.04em]">{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={openCommandPalette}
        className="flex flex-1 flex-col items-center gap-1.5 text-center text-t3"
      >
        <SearchIcon />
        <span className="text-[11px] font-medium tracking-[0.04em]">Search</span>
      </button>
      <Link
        href="/settings"
        className={`flex flex-1 flex-col items-center gap-1.5 text-center ${pathname.startsWith("/settings") ? "text-acc-text" : "text-t3"}`}
      >
        <SettingsIcon />
        <span className="text-[11px] font-medium tracking-[0.04em]">Settings</span>
      </Link>
    </nav>
  );
}

function HomeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PairingModal } from "@/components/shell/PairingModal";
import { fetchPlaylists } from "@/lib/api/playlistsClient";
import { fetchTrash } from "@/lib/api/trashClient";
import { listPairedDevices } from "@/lib/api/pairingClient";
import { PALETTES } from "@/lib/theme/palettes";
import { useIngestStore } from "@/lib/store/ingest";
import { useSettingsStore } from "@/lib/store/settings";

const NAV_ITEMS = [
  { label: "Home", icon: HomeIcon, href: "/", match: (path: string) => path === "/" },
  { label: "Library", icon: LibraryIcon, href: "/library", match: (path: string) => path.startsWith("/library") || path.startsWith("/albums") || path.startsWith("/artists") },
  { label: "Crates", icon: CratesIcon, href: "/crates", match: (path: string) => path.startsWith("/crates") },
  { label: "Import", icon: ImportIcon, href: "/import", match: (path: string) => path.startsWith("/import") },
] as const;

const CRATE_DOTS = ["var(--lf-acc)", "var(--lf-playing)", "var(--lf-ok)", "var(--lf-t3)"] as const;

export function NavRail() {
  const pathname = usePathname();
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const cratesQuery = useQuery({ queryKey: ["playlists"], queryFn: () => fetchPlaylists() });
  const trashQuery = useQuery({ queryKey: ["trash", "count"], queryFn: () => fetchTrash({ limit: 1 }) });
  const devicesQuery = useQuery({ queryKey: ["pairing", "devices"], queryFn: listPairedDevices });
  const pairedDevices = devicesQuery.data?.items ?? [];
  const crates = cratesQuery.data?.items ?? [];
  const trashCount = trashQuery.data?.total ?? 0;
  const isIndexing = useIngestStore((s) =>
    s.jobs.some((job) => job.status === "pending" || job.status === "running")
  );
  const palette = useSettingsStore((s) => s.palette);
  const paletteName = PALETTES.find((p) => p.id === palette)?.name ?? "Palette";

  return (
    <nav className="hidden w-[240px] shrink-0 flex-col border-r border-line bg-bg px-3 py-5 md:flex">
      <div className="mb-5 flex items-center gap-2.5 px-2">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-acc" aria-hidden>
          <span className="h-[5px] w-[5px] rounded-full bg-acc" />
        </span>
        <span className="font-serif text-[19px] leading-none text-t1">local‑fi</span>
      </div>

      <Link
        href="/import"
        className="lf-top mb-5 flex w-full items-center gap-2.5 rounded-lg border border-acc bg-acc px-3 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2"
      >
        <ImportIcon />
        Import files
      </Link>

      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ label, icon: Icon, href, match }) => {
          const isActive = match(pathname);
          return (
            <li key={label}>
              <Link
                href={href}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] ${
                  isActive
                    ? "border-line bg-surf-2 font-semibold text-t1"
                    : "border-transparent font-normal text-t2 hover:bg-surf-2 hover:text-t1"
                }`}
              >
                <Icon />
                {label}
                {label === "Import" && isIndexing ? (
                  <span
                    className="lf-index-pulse ml-auto h-1.5 w-1.5 rounded-full bg-acc"
                    title="Indexing library"
                    aria-label="Indexing library"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 mb-3 px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">Crates</p>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {cratesQuery.isSuccess && crates.length === 0 ? (
          <Link href="/crates" className="rounded-lg px-3 py-1.5 text-[13px] text-t3 hover:bg-surf-2 hover:text-t1">
            No crates yet
          </Link>
        ) : (
          crates.slice(0, 8).map((crate, i) => (
            <Link
              key={crate.id}
              href={`/crates/${crate.id}`}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] hover:bg-surf-2 hover:text-t1 ${
                pathname === `/crates/${crate.id}` ? "bg-surf-2 text-t1" : "text-t2"
              }`}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
                style={{ background: CRATE_DOTS[i % CRATE_DOTS.length] }}
                aria-hidden
              />
              <span className="min-w-0 truncate">{crate.name}</span>
            </Link>
          ))
        )}
      </div>

      <div className="mt-3 lf-card rounded-lg px-3 py-3">
        <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-t2">
          <span>Theme</span>
          <span className="truncate pl-2 text-t3">{paletteName}</span>
        </div>
        <ThemeToggle />
      </div>

      <Link
        href="/trash"
        className={`mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] hover:bg-surf-2 hover:text-t1 ${
          pathname.startsWith("/trash")
            ? "border-line bg-surf-2 font-semibold text-t1"
            : "border-transparent text-t2"
        }`}
      >
        <TrashIcon />
        Trash
        {trashCount > 0 ? <span className="ml-auto font-mono text-[11px] text-t3">{trashCount}</span> : null}
      </Link>

      <button
        type="button"
        onClick={() => setIsPairingOpen(true)}
        className="mt-1 flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-[13px] text-t2 hover:bg-surf-2 hover:text-t1"
      >
        <DeviceIcon />
        {pairedDevices.length > 0 ? pairedDevices[0].name : "Pair a phone"}
        <span
          className="ml-auto h-[7px] w-[7px] rounded-full"
          style={{ background: pairedDevices.length > 0 ? "var(--lf-ok)" : "var(--lf-t3)" }}
          aria-hidden
        />
      </button>
      {isPairingOpen ? <PairingModal onClose={() => setIsPairingOpen(false)} /> : null}

      <Link
        href="/settings"
        className={`mt-1 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] hover:bg-surf-2 hover:text-t1 ${
          pathname.startsWith("/settings")
            ? "border-line bg-surf-2 font-semibold text-t1"
            : "border-transparent text-t2"
        }`}
      >
        <SettingsIcon />
        Settings
      </Link>

      <Link
        href="/health"
        className={`mt-1 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] hover:bg-surf-2 hover:text-t1 ${
          pathname.startsWith("/health")
            ? "border-line bg-surf-2 font-semibold text-t1"
            : "border-transparent text-t2"
        }`}
      >
        <HealthIcon />
        Health
      </Link>
    </nav>
  );
}

function HomeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function CratesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <rect x="3" y="10" width="18" height="4" rx="1" />
      <rect x="3" y="16" width="18" height="4" rx="1" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

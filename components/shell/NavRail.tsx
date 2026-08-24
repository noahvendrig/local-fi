"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { fetchPlaylists } from "@/lib/api/playlistsClient";

const NAV_ITEMS = [
  { label: "Library", icon: LibraryIcon, href: "/", match: (path: string) => path === "/" || path.startsWith("/albums") || path.startsWith("/artists") },
  { label: "Crates", icon: CratesIcon, href: "/crates", match: (path: string) => path.startsWith("/crates") },
  { label: "Import", icon: ImportIcon, href: "/import", match: (path: string) => path.startsWith("/import") },
] as const;

const CRATE_DOTS = ["var(--lf-acc)", "var(--lf-playing)", "var(--lf-ok)", "var(--lf-t3)"] as const;

export function NavRail() {
  const pathname = usePathname();
  const cratesQuery = useQuery({ queryKey: ["playlists"], queryFn: () => fetchPlaylists() });
  const crates = cratesQuery.data?.items ?? [];

  return (
    <nav className="flex w-[240px] shrink-0 flex-col border-r border-line bg-bg px-3 py-5">
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
        </div>
        <ThemeToggle />
      </div>

      <Link
        href="/health"
        className={`mt-2.5 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] hover:bg-surf-2 hover:text-t1 ${
          pathname.startsWith("/health")
            ? "border-line bg-surf-2 font-semibold text-t1"
            : "border-transparent text-t2"
        }`}
      >
        <HealthIcon />
        Settings & health
      </Link>
    </nav>
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

function HealthIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 3" />
    </svg>
  );
}

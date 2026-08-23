import Link from "next/link";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const NAV_ITEMS = [
  { label: "Library", icon: LibraryIcon, href: "/", enabled: true },
  { label: "Crates", icon: CratesIcon, href: "/crates", enabled: false },
  { label: "Health", icon: HealthIcon, href: "/health", enabled: false },
] as const;

export function NavRail() {
  return (
    <nav className="flex w-[240px] shrink-0 flex-col border-r border-line bg-surf">
      <div className="flex items-center gap-2 px-5 py-6">
        <span className="h-6 w-6 rounded-full bg-acc" aria-hidden />
        <span className="font-serif text-lg text-t1">local-fi</span>
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

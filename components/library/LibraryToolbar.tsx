"use client";

import type { AlbumSort, TrackSort } from "@/lib/api-client";
import { useCommandPaletteStore } from "@/lib/store/commandPalette";
import { useLibraryStore, type LibraryViewMode } from "@/lib/store/library";

const TRACK_SORT_OPTIONS: { value: TrackSort; label: string }[] = [
  { value: "date_added_desc", label: "Date added" },
  { value: "title_asc", label: "Title" },
  { value: "duration_asc", label: "Duration" },
];

const ALBUM_SORT_OPTIONS: { value: AlbumSort; label: string }[] = [
  { value: "date_added_desc", label: "Date added" },
  { value: "title_asc", label: "Title" },
  { value: "year_desc", label: "Year" },
];

interface LibraryToolbarProps {
  trackSort: TrackSort;
  onTrackSortChange: (sort: TrackSort) => void;
  albumSort: AlbumSort;
  onAlbumSortChange: (sort: AlbumSort) => void;
  losslessOnly: boolean;
  onLosslessOnlyChange: (value: boolean) => void;
  meta?: string;
}

export function LibraryToolbar({
  trackSort,
  onTrackSortChange,
  albumSort,
  onAlbumSortChange,
  losslessOnly,
  onLosslessOnlyChange,
  meta,
}: LibraryToolbarProps) {
  const viewMode = useLibraryStore((s) => s.viewMode);
  const setViewMode = useLibraryStore((s) => s.setViewMode);
  const openCommandPalette = useCommandPaletteStore((s) => s.open);

  return (
    <div className="flex flex-none flex-col gap-3 px-10 pb-4 pt-[22px]">
      <div className="flex items-center gap-4">
        <h1 className="whitespace-nowrap text-[28px] font-bold leading-[1.2] text-t1">Your Library</h1>
        {meta ? <span className="truncate pt-2 font-mono text-xs text-t3">{meta}</span> : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex min-w-[190px] items-center gap-2.5 rounded-lg border border-line bg-surf px-3 py-2 text-[13px] text-t2 hover:border-acc hover:text-t1"
        >
          <SearchIcon />
          Search library
          <span className="ml-auto font-mono text-[11px] text-t3">⌘K</span>
        </button>
        <ViewToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === "grid" ? (
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-semibold leading-[1.3] text-t1">Recently added</h2>
          <SortSelect value={albumSort} options={ALBUM_SORT_OPTIONS} onChange={onAlbumSortChange} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SortSelect value={trackSort} options={TRACK_SORT_OPTIONS} onChange={onTrackSortChange} />
          <button
            type="button"
            onClick={() => onLosslessOnlyChange(!losslessOnly)}
            aria-pressed={losslessOnly}
            className={`rounded px-[11px] py-1.5 text-[11px] font-medium uppercase tracking-[0.04em] ${
              losslessOnly
                ? "border border-acc bg-[var(--lf-tint)] text-acc-text"
                : "border border-line bg-transparent text-t2 hover:border-acc-2"
            }`}
          >
            Lossless only
          </button>
        </div>
      )}
    </div>
  );
}

function SortSelect<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-lg border border-line bg-surf px-2.5 py-1.5 font-mono text-[11px] text-t3"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function ViewToggle({ viewMode, onChange }: { viewMode: LibraryViewMode; onChange: (mode: LibraryViewMode) => void }) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-line bg-surf p-[3px]">
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-pressed={viewMode === "grid"}
        className={`rounded-[5px] px-[11px] py-1.5 text-[11px] font-medium uppercase tracking-[0.04em] ${
          viewMode === "grid" ? "bg-surf-2 text-t1" : "text-t3 hover:text-t1"
        }`}
      >
        Grid
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-pressed={viewMode === "list"}
        className={`rounded-[5px] px-[11px] py-1.5 text-[11px] font-medium uppercase tracking-[0.04em] ${
          viewMode === "list" ? "bg-surf-2 text-t1" : "text-t3 hover:text-t1"
        }`}
      >
        List
      </button>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

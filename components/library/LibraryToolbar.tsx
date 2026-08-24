"use client";

import type { AlbumSort, TrackSort } from "@/lib/api-client";
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
}

export function LibraryToolbar({
  trackSort,
  onTrackSortChange,
  albumSort,
  onAlbumSortChange,
  losslessOnly,
  onLosslessOnlyChange,
}: LibraryToolbarProps) {
  const viewMode = useLibraryStore((s) => s.viewMode);
  const setViewMode = useLibraryStore((s) => s.setViewMode);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
      <div className="flex items-center gap-3">
        {viewMode === "grid" ? (
          <SortSelect value={albumSort} options={ALBUM_SORT_OPTIONS} onChange={onAlbumSortChange} />
        ) : (
          <>
            <SortSelect value={trackSort} options={TRACK_SORT_OPTIONS} onChange={onTrackSortChange} />
            <label className="flex items-center gap-1.5 text-xs text-t2">
              <input
                type="checkbox"
                checked={losslessOnly}
                onChange={(e) => onLosslessOnlyChange(e.target.checked)}
                className="accent-acc"
              />
              Lossless only
            </label>
          </>
        )}
      </div>

      <ViewToggle viewMode={viewMode} onChange={setViewMode} />
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
      className="rounded-md border border-line bg-surf px-2 py-1 text-xs text-t1"
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
    <div className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-pressed={viewMode === "grid"}
        aria-label="Grid view"
        className={`rounded px-2 py-1 text-xs ${viewMode === "grid" ? "bg-[var(--lf-tint)] text-acc-text" : "text-t3 hover:text-t1"}`}
      >
        <GridIcon />
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-pressed={viewMode === "list"}
        aria-label="List view"
        className={`rounded px-2 py-1 text-xs ${viewMode === "list" ? "bg-[var(--lf-tint)] text-acc-text" : "text-t3 hover:text-t1"}`}
      >
        <ListIcon />
      </button>
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchPlaylists } from "@/lib/api/playlistsClient";
import { NewCrateModal } from "./NewCrateModal";

export function CratesView() {
  const [isCreating, setIsCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["playlists"], queryFn: () => fetchPlaylists() });

  const crates = data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <h1 className="font-serif text-xl text-t1">Crates</h1>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="rounded-md bg-acc px-3 py-1.5 text-xs font-medium text-[var(--lf-on-acc)] hover:bg-acc-2"
        >
          + New crate
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? null : crates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm text-t2">No crates yet.</p>
            <button type="button" onClick={() => setIsCreating(true)} className="text-sm font-medium text-acc-text hover:underline">
              Create your first crate
            </button>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {crates.map((crate) => (
              <li key={crate.id}>
                <Link
                  href={`/crates/${crate.id}`}
                  className="flex flex-col gap-1 rounded-lg border border-line bg-surf p-4 hover:bg-surf-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-t1">{crate.name}</span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${crate.type === "smart" ? "bg-ok/20 text-ok" : "bg-surf-2 text-t2"}`}
                    >
                      {crate.type}
                    </span>
                  </div>
                  <span className="text-xs text-t3">
                    {crate.trackCount} track{crate.trackCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isCreating && <NewCrateModal onClose={() => setIsCreating(false)} />}
    </div>
  );
}

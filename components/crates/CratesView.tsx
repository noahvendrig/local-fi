"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { withAuthQuery } from "@/lib/api/http";
import { fetchPlaylists } from "@/lib/api/playlistsClient";
import { NewCrateModal } from "./NewCrateModal";

export function CratesView() {
  const [isCreating, setIsCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["playlists"], queryFn: () => fetchPlaylists() });

  const crates = data?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-10 py-[22px]">
        <h1 className="text-[28px] font-bold leading-[1.2] text-t1">Crates</h1>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="lf-top rounded-lg border border-acc bg-acc px-4 py-2.5 text-[13px] font-semibold text-on-acc hover:border-acc-2 hover:bg-acc-2"
        >
          + New crate
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-8">
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
                  className="lf-card lf-album-card group min-w-0 rounded-2xl p-4 transition-[background,border-color] duration-150 hover:border-t3 hover:bg-surf-2"
                >
                  <div className="lf-hatch relative aspect-square overflow-hidden rounded-[20px] shadow-[var(--lf-art-shadow)]">
                    {crate.coverArtUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local-only images
                      <img
                        src={withAuthQuery(crate.coverArtUrl)}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center px-3 text-center" aria-hidden>
                        <span className="font-mono text-[10.5px] leading-[1.4] text-t3">no art · crate</span>
                      </div>
                    )}
                    <span
                      className={`absolute left-2.5 top-2.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${crate.type === "smart" ? "bg-ok/20 text-ok" : "bg-surf-2/90 text-t2"}`}
                    >
                      {crate.type}
                    </span>
                  </div>
                  <div className="mt-3.5 min-w-0">
                    <p className="truncate text-base font-semibold leading-[1.4] text-t1" title={crate.name}>
                      {crate.name}
                    </p>
                    <p className="truncate text-sm leading-[1.5] text-t2">
                      {crate.trackCount} track{crate.trackCount === 1 ? "" : "s"}
                    </p>
                  </div>
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

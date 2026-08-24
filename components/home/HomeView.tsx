"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchHomeStats, type HomeBackInRotationTrack, type HomeTopTrack } from "@/lib/api/homeClient";
import { withAuthQuery } from "@/lib/api/http";
import { useCommandPaletteStore } from "@/lib/store/commandPalette";
import { usePlayerStore } from "@/lib/store/player";
import { useSettingsStore } from "@/lib/store/settings";
import { AlbumPlaceholderIcon, PlayingIcon } from "@/components/shell/PlayerIcons";

const FORMAT_COLORS = ["bg-ok", "bg-warn", "bg-acc", "bg-err"] as const;
const FORMAT_TEXT_COLORS = ["text-ok", "text-warn", "text-acc-text", "text-err"] as const;

// Home dashboard (design board 1, "isHome" section): weekly listening stats sourced from
// GET /api/v1/home, which reads the play_events log written by TransportBar on track completion.
export function HomeView() {
  const openCommandPalette = useCommandPaletteStore((s) => s.open);
  const homeQuery = useQuery({ queryKey: ["home"], queryFn: fetchHomeStats });

  const data = homeQuery.data;
  const hasActivity = !!data && data.stats.some((s) => Number.parseFloat(s.value) > 0) && data.top5.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-4 px-10 pb-4 pt-[22px]">
        <h1 className="whitespace-nowrap text-[28px] font-bold leading-[1.2] text-t1">Home</h1>
        {data ? <span className="truncate pt-2 font-mono text-xs text-t3">{data.rangeLabel}</span> : null}
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
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-8">
        {!data ? null : (
          <div className="flex flex-col gap-6 pt-1">
            <div className="grid grid-cols-3 gap-3">
              {data.stats.map((stat) => (
                <div key={stat.label} className="lf-card rounded-2xl px-[18px] py-4">
                  <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">{stat.label}</p>
                  <p className="mb-2 font-mono text-[30px] leading-none text-t1">{stat.value}</p>
                  <p className="font-mono text-[11px] text-t2">{stat.meta}</p>
                </div>
              ))}
            </div>

            {!hasActivity ? (
              <div className="lf-card flex flex-col items-center gap-1.5 rounded-2xl px-6 py-16 text-center">
                <p className="text-base font-semibold text-t1">No listening data yet</p>
                <p className="max-w-sm text-sm text-t2">Play some tracks and this page will fill in with your weekly stats.</p>
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(360px,1fr)_260px] items-start gap-5">
                <div>
                  <div className="mb-3.5 flex items-baseline gap-2.5">
                    <h2 className="text-xl font-semibold leading-[1.3] text-t1">Top 5 songs</h2>
                    <span className="font-mono text-xs text-t3">by plays · {data.rangeLabel}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {data.top5.map((t) => (
                      <TopTrackRow key={t.track.id} item={t} />
                    ))}
                  </div>

                  {data.backInRotation.length > 0 && (
                    <>
                      <div className="mb-3.5 mt-7 flex items-baseline gap-2.5">
                        <h2 className="text-xl font-semibold leading-[1.3] text-t1">Back in rotation</h2>
                        <span className="font-mono text-xs text-t3">played again after a long gap</span>
                      </div>
                      <div className="flex flex-col gap-2 pb-[72px]">
                        {data.backInRotation.map((b) => (
                          <BackInRotationRow key={b.track.id} item={b} />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <div className="lf-card rounded-2xl px-[18px] py-4">
                    <p className="mb-3.5 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">Most played artists</p>
                    <div className="flex flex-col gap-2.5">
                      {data.topArtists.length === 0 ? (
                        <p className="text-xs text-t3">Nothing played yet.</p>
                      ) : (
                        data.topArtists.map((a) => (
                          <div key={a.artistId}>
                            <div className="mb-1 flex items-baseline justify-between">
                              <span className="min-w-0 truncate text-sm text-t1">{a.name}</span>
                              <span className="shrink-0 pl-2.5 font-mono text-[11px] text-t2">{a.plays}</span>
                            </div>
                            <div className="h-1 overflow-hidden rounded-sm bg-surf-2">
                              <div className="h-full bg-playing" style={{ width: `${a.barW}%` }} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="lf-card rounded-2xl px-[18px] py-4">
                    <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">Plays by day</p>
                    <div className="flex h-24 items-end gap-2">
                      {data.days.map((d) => (
                        <div key={d.date} className="flex h-full flex-1 flex-col justify-end gap-1.5">
                          <span className="text-center font-mono text-[10px] text-t3">{d.plays}</span>
                          <div className="min-h-1 rounded-sm bg-playing" style={{ height: `${d.h}%` }} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      {data.days.map((d) => (
                        <span key={d.date} className="flex-1 text-center font-mono text-[10px] text-t3">
                          {d.label.slice(0, 3)}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="lf-card rounded-2xl px-[18px] py-4">
                    <p className="mb-3.5 text-[11px] font-medium uppercase tracking-[0.04em] text-t3">What you played, by format</p>
                    {data.formats.length === 0 ? (
                      <p className="text-xs text-t3">Nothing played yet.</p>
                    ) : (
                      <>
                        <div className="mb-3 flex h-2 overflow-hidden rounded-sm">
                          {data.formats.map((f, i) => (
                            <div
                              key={f.format}
                              className={FORMAT_COLORS[i % FORMAT_COLORS.length]}
                              style={{ width: `${f.pct}%` }}
                            />
                          ))}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {data.formats.map((f, i) => (
                            <div key={f.format} className="flex items-center gap-2">
                              <span className={`h-2 w-2 shrink-0 rounded-sm ${FORMAT_COLORS[i % FORMAT_COLORS.length]}`} />
                              <span className={`flex-1 font-mono text-xs uppercase ${FORMAT_TEXT_COLORS[i % FORMAT_TEXT_COLORS.length]}`}>
                                {f.format}
                              </span>
                              <span className="font-mono text-xs text-t1">{f.pct}%</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TopTrackRow({ item }: { item: HomeTopTrack }) {
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);
  const isCurrent = item.track.id === currentTrackId;

  return (
    <div
      onClick={() => playTrack(item.track)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playTrack(item.track);
        }
      }}
      className="lf-card grid cursor-pointer grid-cols-[28px_52px_minmax(120px,1fr)_78px] items-center gap-3.5 rounded-2xl px-3.5 py-3 transition-[background,border-color] duration-150 hover:border-acc hover:bg-surf-2"
    >
      <span className={`font-mono text-xl leading-none ${isCurrent ? "text-playing" : "text-t3"}`}>
        {isCurrent && isPlaying ? <PlayingIcon /> : item.rank}
      </span>
      <TrackArt url={item.track.coverArtUrl} size={52} rounded="rounded-[10px]" />
      <div className="min-w-0">
        <p className={`truncate text-[15px] font-semibold leading-[1.4] ${isCurrent ? "text-playing" : "text-t1"}`}>
          {item.track.title ?? "Untitled"}
        </p>
        <p className="mb-1.5 truncate font-mono text-xs text-t3">
          {item.track.artistName ?? "Unknown artist"} · {item.track.albumTitle ?? "—"}
        </p>
        <div className="h-[5px] overflow-hidden rounded-sm bg-surf-2">
          <div className="h-full rounded-sm bg-playing" style={{ width: `${item.barW}%` }} />
        </div>
      </div>
      <div className="text-right">
        <p className="font-mono text-[13px] text-t1">{item.plays} plays</p>
        {showFormatBadges ? (
          <p className={`font-mono text-[10px] ${item.track.lossless ? "text-ok" : "text-warn"}`}>{item.track.format.toUpperCase()}</p>
        ) : null}
      </div>
    </div>
  );
}

function BackInRotationRow({ item }: { item: HomeBackInRotationTrack }) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  return (
    <div
      onClick={() => playTrack(item.track)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          playTrack(item.track);
        }
      }}
      className="lf-card grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 rounded-2xl px-3.5 py-[13px] transition-[background,border-color] duration-150 hover:border-acc hover:bg-surf-2"
    >
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-[1.4] text-t1">{item.track.title ?? "Untitled"}</p>
        <p className="truncate font-mono text-xs text-t2">{item.track.artistName ?? "Unknown artist"}</p>
      </div>
      <span className="whitespace-nowrap font-mono text-[11px] text-t3">{item.meta}</span>
    </div>
  );
}

function TrackArt({ url, size, rounded }: { url: string | null; size: number; rounded: string }) {
  return (
    <div className={`lf-hatch shrink-0 overflow-hidden ${rounded}`} style={{ width: size, height: size }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local-only images
        <img src={withAuthQuery(url)} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-t3" aria-hidden>
          <AlbumPlaceholderIcon />
        </div>
      )}
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

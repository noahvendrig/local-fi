"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PALETTES, type PaletteDef } from "@/lib/theme/palettes";
import {
  useSettingsStore,
  type CrossfadeSeconds,
  type ProgressStyle,
} from "@/lib/store/settings";
import { usePlayerStore } from "@/lib/store/player";
import { formatDuration } from "@/lib/format/track";

const PREVIEW_BARS = [0.28, 0.46, 0.72, 0.4, 0.88, 0.62, 0.34, 0.78, 0.52, 0.94, 0.58, 0.36, 0.7, 0.48, 0.82, 0.3, 0.64, 0.44, 0.9, 0.38, 0.56, 0.74, 0.42, 0.66];

const SHORTCUTS = [
  { keys: "Space", action: "Play / pause" },
  { keys: "← / →", action: "Seek" },
  { keys: "Shift + ← / →", action: "Previous / next" },
  { keys: "↑ / ↓", action: "Volume" },
  { keys: "M", action: "Mute" },
  { keys: "Q", action: "Queue" },
  { keys: "F", action: "Now Playing" },
  { keys: "Esc", action: "Close overlay" },
  { keys: "⌘K", action: "Command palette" },
  { keys: "⌘,", action: "Open settings" },
];

export function SettingsView() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const palette = useSettingsStore((s) => s.palette);
  const setPalette = useSettingsStore((s) => s.setPalette);
  const progressStyle = useSettingsStore((s) => s.progressStyle);
  const setProgressStyle = useSettingsStore((s) => s.setProgressStyle);
  const timeDisplay = useSettingsStore((s) => s.timeDisplay);
  const setTimeDisplay = useSettingsStore((s) => s.setTimeDisplay);
  const density = useSettingsStore((s) => s.density);
  const setDensity = useSettingsStore((s) => s.setDensity);
  const nowPlayingBackdrop = useSettingsStore((s) => s.nowPlayingBackdrop);
  const setNowPlayingBackdrop = useSettingsStore((s) => s.setNowPlayingBackdrop);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const setReducedMotion = useSettingsStore((s) => s.setReducedMotion);
  const showTrackInTitle = useSettingsStore((s) => s.showTrackInTitle);
  const setShowTrackInTitle = useSettingsStore((s) => s.setShowTrackInTitle);
  const vinylSpin = useSettingsStore((s) => s.vinylSpin);
  const setVinylSpin = useSettingsStore((s) => s.setVinylSpin);
  const hotkeysEnabled = useSettingsStore((s) => s.hotkeysEnabled);
  const setHotkeysEnabled = useSettingsStore((s) => s.setHotkeysEnabled);
  const seekStep = useSettingsStore((s) => s.seekStep);
  const setSeekStep = useSettingsStore((s) => s.setSeekStep);
  const trackNotifications = useSettingsStore((s) => s.trackNotifications);
  const setTrackNotifications = useSettingsStore((s) => s.setTrackNotifications);
  const showFormatBadges = useSettingsStore((s) => s.showFormatBadges);
  const setShowFormatBadges = useSettingsStore((s) => s.setShowFormatBadges);
  const loudnessMatch = useSettingsStore((s) => s.loudnessMatch);
  const setLoudnessMatch = useSettingsStore((s) => s.setLoudnessMatch);
  const crossfadeSeconds = useSettingsStore((s) => s.crossfadeSeconds);
  const setCrossfadeSeconds = useSettingsStore((s) => s.setCrossfadeSeconds);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  async function handleNotifications(enabled: boolean) {
    if (enabled && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setTrackNotifications(false);
        return;
      }
    }
    setTrackNotifications(enabled);
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-10 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-[1.2] text-t1">Settings</h1>
          <p className="mt-1 text-sm text-t2">Appearance, playback, and how the player feels.</p>
        </div>
        <button
          type="button"
          onClick={resetSettings}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t2 hover:border-acc hover:text-t1"
        >
          Reset to defaults
        </button>
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Appearance</h2>
        <p className="mt-1 text-sm text-t2">Each palette keeps one action colour and one playback colour. Light and dark are pairs, not separate themes.</p>

        <div className="mt-4">
          <SegmentedControl
            ariaLabel="Colour mode"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Night" },
              { value: "light", label: "Daylight" },
            ]}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {PALETTES.map((def) => (
            <PaletteCard key={def.id} def={def} active={palette === def.id} theme={theme} onSelect={() => setPalette(def.id)} />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Player</h2>

        <SettingRow
          title="Progress bar"
          description="Waveform uses imported peaks. Thin bar is a simple played track. Spectrum is a live analyser."
        >
          <div className="flex flex-col items-end gap-2">
            <SegmentedControl
              ariaLabel="Progress bar style"
              value={progressStyle}
              onChange={setProgressStyle}
              options={[
                { value: "waveform", label: "Waveform" },
                { value: "bar", label: "Thin bar" },
                { value: "spectrum", label: "Spectrum" },
              ]}
            />
            <ProgressPreview style={progressStyle} />
          </div>
        </SettingRow>

        <SettingRow title="Time display" description="What the right-hand time in the scrubber shows while a track plays.">
          <SegmentedControl
            ariaLabel="Time display"
            value={timeDisplay}
            onChange={setTimeDisplay}
            options={[
              { value: "duration", label: "Duration" },
              { value: "remaining", label: "Remaining" },
            ]}
          />
        </SettingRow>

        <SettingRow
          title="Loudness match"
          description="Uses each track's stored average level so quiet and loud albums sit closer together. On by default."
        >
          <Toggle checked={loudnessMatch} onChange={setLoudnessMatch} label={loudnessMatch ? "On" : "Off"} />
        </SettingRow>

        <SettingRow
          title="Crossfade"
          description="Overlaps the end of one track with the start of the next so the gap between native audio elements disappears."
        >
          <SegmentedControl
            ariaLabel="Crossfade"
            value={crossfadeSeconds}
            onChange={(value) => setCrossfadeSeconds(value as CrossfadeSeconds)}
            options={[
              { value: 0, label: "Off" },
              { value: 2, label: "2s" },
              { value: 3, label: "3s" },
              { value: 4, label: "4s" },
            ]}
          />
        </SettingRow>

        <SettingRow title="Sleep timer" description="Pause playback after a stretch of listening, or when the current track ends.">
          <SleepTimerControls />
        </SettingRow>

        <SettingRow title="Vinyl spin" description="Turns Now Playing artwork into a spinning disc while audio is running.">
          <Toggle checked={vinylSpin} onChange={setVinylSpin} label={vinylSpin ? "On" : "Off"} />
        </SettingRow>

        <SettingRow title="Tab title" description="Show the playing track in the browser tab, with a play marker while audio is running.">
          <Toggle checked={showTrackInTitle} onChange={setShowTrackInTitle} label={showTrackInTitle ? "On" : "Off"} />
        </SettingRow>

        <SettingRow
          title="Track change notifications"
          description="Desktop notification when the next track starts, only while this tab is in the background."
        >
          <Toggle checked={trackNotifications} onChange={(v) => void handleNotifications(v)} label={trackNotifications ? "On" : "Off"} />
        </SettingRow>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Interface</h2>

        <SettingRow title="Density" description="Comfortable is the default spacing. Compact packs more albums and tracks on screen.">
          <SegmentedControl
            ariaLabel="Interface density"
            value={density}
            onChange={setDensity}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </SettingRow>

        <SettingRow title="Now Playing backdrop" description="Glass is the frosted radial glow. Solid is a flat surface with no blur.">
          <SegmentedControl
            ariaLabel="Now Playing backdrop"
            value={nowPlayingBackdrop}
            onChange={setNowPlayingBackdrop}
            options={[
              { value: "glass", label: "Glass" },
              { value: "solid", label: "Solid" },
            ]}
          />
        </SettingRow>

        <SettingRow title="Format badges" description="Show FLAC / MP3 chips on album cards, lists, and the transport bar.">
          <Toggle checked={showFormatBadges} onChange={setShowFormatBadges} label={showFormatBadges ? "On" : "Off"} />
        </SettingRow>

        <SettingRow title="Reduce motion" description="Cuts rise animations, vinyl spin, and hover transforms.">
          <Toggle checked={reducedMotion} onChange={setReducedMotion} label={reducedMotion ? "On" : "Off"} />
        </SettingRow>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Keyboard</h2>

        <SettingRow title="Playback shortcuts" description="Space, arrows, M, Q, and F. Ignored while typing in a field.">
          <Toggle checked={hotkeysEnabled} onChange={setHotkeysEnabled} label={hotkeysEnabled ? "On" : "Off"} />
        </SettingRow>

        <SettingRow title="Seek step" description="How far Left and Right jump, and how far media-key skip moves.">
          <SegmentedControl
            ariaLabel="Seek step"
            value={seekStep}
            onChange={setSeekStep}
            options={[
              { value: 5, label: "5s" },
              { value: 10, label: "10s" },
              { value: 15, label: "15s" },
            ]}
          />
        </SettingRow>

        <div className="lf-card mt-4 overflow-hidden rounded-2xl">
          {SHORTCUTS.map((row) => (
            <div key={row.keys} className="flex items-center justify-between gap-4 border-b border-line px-5 py-2.5 last:border-b-0">
              <span className="text-sm text-t2">{row.action}</span>
              <kbd className="rounded border border-line bg-surf-2 px-2 py-1 font-mono text-[11px] text-t1">{row.keys}</kbd>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 pb-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-t3">Library</h2>
        <div className="lf-card mt-4 flex items-center justify-between gap-4 rounded-2xl px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-t1">Library health</p>
            <p className="mt-0.5 text-sm text-t2">Missing files, duplicate groups, and rescan live on their own page.</p>
          </div>
          <Link
            href="/health"
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-t1 hover:border-acc hover:bg-surf-2"
          >
            Open health
          </Link>
        </div>
      </section>
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 border-b border-line py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-semibold text-t1">{title}</p>
        <p className="mt-0.5 text-sm text-t2">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-0.5 rounded-lg border border-line bg-surf p-[3px]">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={`rounded-[5px] px-[11px] py-1.5 text-[11px] font-medium uppercase tracking-[0.04em] ${
              selected ? "bg-surf-2 text-t1" : "text-t3 hover:text-t1"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 ${
        checked ? "border-acc bg-[var(--lf-tint)]" : "border-line bg-surf"
      }`}
    >
      <span
        className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-acc" : "bg-surf-2"
        }`}
        aria-hidden
      >
        <span
          className={`h-4 w-4 rounded-full bg-on-acc transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </span>
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-t2">{label}</span>
    </button>
  );
}

function ProgressPreview({ style }: { style: ProgressStyle }) {
  if (style === "bar") {
    return (
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full w-[42%] rounded-full bg-playing" />
      </div>
    );
  }
  const bars = style === "spectrum" ? PREVIEW_BARS.map((h, i) => 0.2 + ((i * 17) % 80) / 100) : PREVIEW_BARS;
  return (
    <div className="flex h-6 w-40 items-end gap-[2px]" aria-hidden>
      {bars.slice(0, 22).map((h, i) => (
        <div
          key={i}
          className="min-w-0 flex-1 rounded-sm bg-playing"
          style={{ height: `${Math.max(18, h * 100)}%`, opacity: style === "waveform" && i / 22 > 0.42 ? 0.4 : 1 }}
        />
      ))}
    </div>
  );
}

function PaletteCard({
  def,
  active,
  theme,
  onSelect,
}: {
  def: PaletteDef;
  active: boolean;
  theme: "dark" | "light";
  onSelect: () => void;
}) {
  const tokens = theme === "light" ? def.light : def.dark;
  const swatches: { role: string; hex: string }[] = [
    { role: "base", hex: tokens.bg },
    { role: "surface", hex: tokens.surf },
    { role: "line", hex: tokens.line },
    { role: "text", hex: tokens.t1 },
    { role: "action", hex: tokens.acc },
    { role: "play", hex: tokens.playing },
  ];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`${def.name}${active ? ", in use" : ""}`}
      className="overflow-hidden rounded-2xl border text-left"
      style={{
        background: tokens.bg,
        borderColor: active ? tokens.acc : tokens.line,
        boxShadow: active ? "var(--lf-shadow)" : "none",
      }}
    >
      <div className="px-[18px] pt-[18px] pb-3.5">
        <p className="font-serif text-[22px] leading-[1.2]" style={{ color: tokens.t1 }}>
          {def.name}
        </p>
        <p className="mt-1 font-mono text-[11px]" style={{ color: tokens.t2 }}>
          {def.hues}
        </p>
      </div>
      <div className="flex px-[18px] pb-4">
        {swatches.map((swatch, i) => (
          <div key={swatch.role} className="min-w-0 flex-1">
            <div
              className="h-[34px] border"
              style={{
                background: swatch.hex,
                borderColor: tokens.line,
                borderRightWidth: i === swatches.length - 1 ? 1 : 0,
              }}
            />
            <p className="pt-1 text-center font-mono text-[8.5px]" style={{ color: tokens.t3 }}>
              {swatch.role}
            </p>
          </div>
        ))}
      </div>
      <div className="mx-[18px] mb-4 rounded-2xl border p-3.5" style={{ borderColor: tokens.line, background: tokens.surf }}>
        <div className="mb-3.5 flex items-center gap-3">
          <div
            className="h-[52px] w-[52px] shrink-0 rounded-xl"
            style={{
              background: `repeating-linear-gradient(45deg, ${tokens.hatchA}, ${tokens.hatchA} 4px, ${tokens.hatchB} 4px, ${tokens.hatchB} 8px)`,
            }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm" style={{ color: tokens.playing }}>
              What&apos;s Going On
            </p>
            <p className="truncate font-mono text-xs" style={{ color: tokens.t3 }}>
              Marvin Gaye · FLAC
            </p>
          </div>
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px]"
            style={{ background: tokens.acc, color: tokens.onAcc }}
            aria-hidden
          >
            ❚❚
          </span>
        </div>
        <div className="flex h-[30px] items-end gap-[2px]">
          {PREVIEW_BARS.map((h, i) => (
            <div
              key={i}
              className="min-w-0 flex-1 rounded-sm"
              style={{
                height: `${h * 100}%`,
                background: i / PREVIEW_BARS.length <= 0.42 ? tokens.playing : tokens.t3,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2.5 px-[18px] pb-[18px]">
        <span className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: tokens.acc, color: tokens.onAcc }}>
          {active ? "In use" : "Apply"}
        </span>
        <span className="font-mono text-[11px]" style={{ color: tokens.t3 }}>
          {active ? "applied" : def.tag}
        </span>
      </div>
    </button>
  );
}

const SLEEP_MINUTES = [15, 30, 45, 60] as const;

function SleepTimerControls() {
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const sleepAfterTrack = usePlayerStore((s) => s.sleepAfterTrack);
  const sleepMinutes = usePlayerStore((s) => s.sleepMinutes);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const setSleepAfterTrack = usePlayerStore((s) => s.setSleepAfterTrack);
  const clearSleepTimer = usePlayerStore((s) => s.clearSleepTimer);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sleepEndsAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sleepEndsAt]);

  const remainingMs = sleepEndsAt != null ? Math.max(0, sleepEndsAt - now) : 0;
  const remainingLabel = sleepEndsAt != null ? formatDuration(remainingMs / 1000) : null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div role="radiogroup" aria-label="Sleep timer" className="flex flex-wrap justify-end gap-0.5 rounded-lg border border-line bg-surf p-[3px]">
        <SleepChip selected={!sleepEndsAt && !sleepAfterTrack} onClick={clearSleepTimer} label="Off" />
        {SLEEP_MINUTES.map((minutes) => (
          <SleepChip
            key={minutes}
            selected={sleepMinutes === minutes}
            onClick={() => setSleepTimer(minutes)}
            label={`${minutes}m`}
          />
        ))}
        <SleepChip selected={sleepAfterTrack} onClick={setSleepAfterTrack} label="This track" />
      </div>
      {remainingLabel ? (
        <p className="font-mono text-[11px] text-playing">Pauses in {remainingLabel}</p>
      ) : sleepAfterTrack ? (
        <p className="font-mono text-[11px] text-playing">Pauses when this track ends</p>
      ) : null}
    </div>
  );
}

function SleepChip({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`rounded-[5px] px-[11px] py-1.5 text-[11px] font-medium uppercase tracking-[0.04em] ${
        selected ? "bg-surf-2 text-t1" : "text-t3 hover:text-t1"
      }`}
    >
      {label}
    </button>
  );
}

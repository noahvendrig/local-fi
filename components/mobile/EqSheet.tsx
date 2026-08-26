"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { EQ_BAND_LABELS, EQ_GAIN_MAX, EQ_GAIN_MIN, EQ_PRESETS, snapEqGain } from "@/lib/audio/eqConfig";
import { usePlayerStore } from "@/lib/store/player";

function formatDb(value: number): string {
  if (Math.abs(value) < 0.05) return "0.0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function gainFromVerticalPointer(clientY: number, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const t = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(rect.height, 1)));
  return snapEqGain((1 - t) * (EQ_GAIN_MAX - EQ_GAIN_MIN) + EQ_GAIN_MIN);
}

function gainFromHorizontalPointer(clientX: number, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const t = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(rect.width, 1)));
  return snapEqGain(t * (EQ_GAIN_MAX - EQ_GAIN_MIN) + EQ_GAIN_MIN);
}

function pctFromGain(gain: number): number {
  return ((gain - EQ_GAIN_MIN) / (EQ_GAIN_MAX - EQ_GAIN_MIN)) * 100;
}

// Drag past this many px before we treat a pointer-down-on-the-handle as a
// dismiss swipe rather than a tap; also the distance the sheet must travel on
// release to count as "let go" instead of snapping back.
const DRAG_TAP_THRESHOLD = 4;
const DRAG_CLOSE_THRESHOLD = 70;

// Touch-sized reflow of EqualizerPopover's faders into a bottom sheet (design board 1c,
// "m5 EQ sheet" frame) — same usePlayerStore EQ slice as desktop, so a change here is the
// same PlaybackEqualizer graph the transport bar/desktop popover already drive.
export function EqSheet({ onClose }: { onClose: () => void }) {
  const eqEnabled = usePlayerStore((s) => s.eqEnabled);
  const eqGains = usePlayerStore((s) => s.eqGains);
  const eqPreamp = usePlayerStore((s) => s.eqPreamp);
  const eqPreset = usePlayerStore((s) => s.eqPreset);
  const setEqBand = usePlayerStore((s) => s.setEqBand);
  const setEqPreamp = usePlayerStore((s) => s.setEqPreamp);
  const setEqPreset = usePlayerStore((s) => s.setEqPreset);

  const presetLabel = eqPreset === "custom" ? "Custom" : (EQ_PRESETS.find((p) => p.id === eqPreset)?.label ?? "Flat");
  const bypassLabel = eqEnabled ? "On" : "Bypassed";

  const sheetRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const draggedRef = useRef(false);
  const startYRef = useRef(0);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current || !sheetRef.current) return;
      const delta = Math.max(0, e.clientY - startYRef.current);
      if (delta > DRAG_TAP_THRESHOLD) draggedRef.current = true;
      sheetRef.current.style.transform = `translateY(${delta}px)`;
    };
    const handleUp = (e: PointerEvent) => {
      if (!draggingRef.current || !sheetRef.current) return;
      draggingRef.current = false;
      const delta = Math.max(0, e.clientY - startYRef.current);
      sheetRef.current.style.transition = "transform 180ms ease-out";
      if (delta > DRAG_CLOSE_THRESHOLD) {
        sheetRef.current.style.transform = "translateY(100%)";
        window.setTimeout(onClose, 160);
      } else {
        sheetRef.current.style.transform = "";
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [onClose]);

  const handleGrab = (e: ReactPointerEvent) => {
    draggingRef.current = true;
    draggedRef.current = false;
    startYRef.current = e.clientY;
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  };

  const handleTap = () => {
    // A drag past the threshold already closes (or snaps back) on pointerup —
    // don't also fire the plain click's close.
    if (draggedRef.current) return;
    onClose();
  };

  return (
    <div ref={sheetRef} className="absolute inset-x-0 bottom-0 z-10 rounded-t-3xl border-t border-line bg-surf px-4 pb-7 pt-3 shadow-[var(--lf-shadow)]">
      <button
        type="button"
        onPointerDown={handleGrab}
        onClick={handleTap}
        aria-label="Close equaliser"
        className="mx-auto mb-4 block h-1 w-11 touch-none rounded-sm bg-line"
      />
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-t1 uppercase">Equaliser</span>
        <span className="font-mono text-[11px] text-t3">10 band</span>
        <div className="flex-1" />
        <span className="rounded-lg border border-line px-3 py-2 font-mono text-[11px] text-t2">{bypassLabel}</span>
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {EQ_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => setEqPreset(preset.id)}
            className={`shrink-0 rounded-lg border px-3 py-2.5 text-xs font-medium whitespace-nowrap ${
              preset.id === eqPreset ? "border-acc bg-[var(--lf-tint)] text-acc-text" : "border-line text-t2"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={`flex items-stretch gap-[3px] ${eqEnabled ? "" : "opacity-40"}`}>
        {EQ_BAND_LABELS.map((label, index) => (
          <MobileEqFader key={label} label={label} value={eqGains[index] ?? 0} onChange={(gain) => setEqBand(index, gain)} />
        ))}
      </div>

      <div className="mt-4.5 flex items-center gap-3 border-t border-line pt-3.5">
        <span className="shrink-0 text-[11px] font-medium tracking-[0.04em] text-t2 uppercase">Pre-amp</span>
        <MobilePreampSlider value={eqPreamp} onChange={setEqPreamp} />
        <span className="w-14 shrink-0 text-right font-mono text-[11px] text-t2">{formatDb(eqPreamp)} dB</span>
      </div>

      <p className="mt-3 text-center font-mono text-[11px] text-t3">{presetLabel}</p>
    </div>
  );
}

function MobilePreampSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pct = pctFromGain(value);

  const applyPointer = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    onChange(gainFromHorizontalPointer(clientX, trackRef.current));
  }, [onChange]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      applyPointer(e.clientX);
    };
    const handleUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [applyPointer]);

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-orientation="horizontal"
      aria-label="Pre-amp"
      aria-valuemin={EQ_GAIN_MIN}
      aria-valuemax={EQ_GAIN_MAX}
      aria-valuenow={value}
      onPointerDown={(e) => {
        draggingRef.current = true;
        applyPointer(e.clientX);
      }}
      className="relative flex h-6 flex-1 touch-none select-none items-center"
    >
      <div className="h-[5px] w-full rounded-sm bg-surf-2" />
      <div className="absolute left-1/2 top-0.5 bottom-0.5 w-px bg-line" />
      <div className="absolute h-6 w-2.5 -translate-x-1/2 rounded-[4px] bg-playing" style={{ left: `${pct}%` }} />
    </div>
  );
}

function MobileEqFader({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pct = pctFromGain(value);
  const isZero = Math.abs(value) < 0.05;
  const fillColor = isZero ? "var(--lf-t2)" : "var(--lf-playing)";

  const applyPointer = useCallback((clientY: number) => {
    if (!trackRef.current) return;
    onChange(gainFromVerticalPointer(clientY, trackRef.current));
  }, [onChange]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      applyPointer(e.clientY);
    };
    const handleUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [applyPointer]);

  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <span className="font-mono text-[10px]" style={{ color: isZero ? "var(--lf-t3)" : "var(--lf-playing)" }}>
        {formatDb(value)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-orientation="vertical"
        aria-label={`${label} Hz`}
        aria-valuemin={EQ_GAIN_MIN}
        aria-valuemax={EQ_GAIN_MAX}
        aria-valuenow={value}
        onPointerDown={(e) => {
          draggingRef.current = true;
          applyPointer(e.clientY);
        }}
        className="relative h-[168px] w-full touch-none select-none"
      >
        <div className="absolute top-0 bottom-0 left-1/2 w-[5px] -translate-x-1/2 rounded-sm bg-surf-2" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        <div
          className="absolute left-1/2 w-[5px] -translate-x-1/2 rounded-sm"
          style={{ bottom: `${Math.min(pct, 50)}%`, height: `${Math.abs(pct - 50)}%`, background: fillColor }}
        />
        <div
          className="absolute left-1/2 h-2.5 w-6 -translate-x-1/2 translate-y-1/2 rounded-[4px] shadow-[var(--lf-art-shadow)]"
          style={{ bottom: `${pct}%`, background: fillColor }}
        />
      </div>
      <span className="font-mono text-[9.5px] text-t3">{label}</span>
    </div>
  );
}

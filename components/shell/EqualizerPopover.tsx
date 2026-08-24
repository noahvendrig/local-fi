"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EQ_BAND_LABELS,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_PRESETS,
  snapEqGain,
} from "@/lib/audio/eqConfig";
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

function curvePoints(gains: number[]): string {
  return gains
    .map((gain, index) => {
      const x = (index / Math.max(gains.length - 1, 1)) * 100;
      const y = 20 - (gain / EQ_GAIN_MAX) * 17;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function EqualizerPopover() {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const eqEnabled = usePlayerStore((s) => s.eqEnabled);
  const eqGains = usePlayerStore((s) => s.eqGains);
  const eqPreamp = usePlayerStore((s) => s.eqPreamp);
  const eqPreset = usePlayerStore((s) => s.eqPreset);
  const setEqEnabled = usePlayerStore((s) => s.setEqEnabled);
  const setEqBand = usePlayerStore((s) => s.setEqBand);
  const setEqPreamp = usePlayerStore((s) => s.setEqPreamp);
  const setEqPreset = usePlayerStore((s) => s.setEqPreset);
  const resetEq = usePlayerStore((s) => s.resetEq);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const presetLabel =
    eqPreset === "custom" ? "Custom" : (EQ_PRESETS.find((preset) => preset.id === eqPreset)?.label ?? "Flat");
  const summary = eqEnabled ? presetLabel : "Bypassed";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label="Equaliser"
        aria-expanded={isOpen}
        className={`flex items-center gap-1.5 rounded-lg border px-[11px] py-[7px] text-[11px] font-medium tracking-[0.04em] uppercase ${
          isOpen ? "border-acc text-acc-text" : "border-line text-t2 hover:border-acc hover:text-t1"
        }`}
      >
        EQ
        <span className="max-w-[7.5rem] truncate font-mono text-[10px] font-normal normal-case tracking-normal text-t3">
          {summary}
        </span>
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Equaliser"
          className="absolute right-0 bottom-full z-40 mb-3 w-[min(35rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surf px-5 pt-[18px] pb-4 shadow-[var(--lf-shadow)]"
          style={{ animation: "lfrise 180ms cubic-bezier(.22,1.3,.4,1)" }}
        >
          <div className="mb-3.5 flex items-center gap-3">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-t1 uppercase">Equaliser</span>
            <span className="font-mono text-[11px] text-t3">10 band · ±12 dB</span>
            <div className="flex-1" />
            <button
              type="button"
              aria-pressed={eqEnabled}
              onClick={() => setEqEnabled(!eqEnabled)}
              className={`rounded-lg border px-[11px] py-1.5 text-[11px] font-medium tracking-[0.04em] uppercase ${
                eqEnabled ? "border-acc bg-acc text-on-acc" : "border-line bg-transparent text-t2 hover:border-acc hover:text-t1"
              }`}
            >
              {eqEnabled ? "On" : "Bypassed"}
            </button>
            <button
              type="button"
              onClick={resetEq}
              className="rounded-lg border border-line bg-transparent px-2.5 py-1.5 font-mono text-[11px] text-t2 hover:border-acc hover:text-t1"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close equaliser"
              className="border-none bg-transparent text-[15px] leading-none text-t3 hover:text-t1"
            >
              ×
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            {EQ_PRESETS.map((preset) => {
              const isOn = eqPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setEqPreset(preset.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap ${
                    isOn ? "border-acc bg-[var(--lf-tint)] text-acc-text" : "border-line bg-transparent text-t2 hover:border-acc"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className={eqEnabled ? "" : "opacity-40"}>
            <div className="relative mx-1 mb-1.5 h-11 overflow-hidden rounded-lg border border-line bg-surf-2">
              <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                <polyline
                  points={curvePoints(eqGains)}
                  fill="none"
                  stroke="var(--lf-playing)"
                  strokeWidth="1"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            <div className="flex items-stretch gap-1">
              {EQ_BAND_LABELS.map((label, index) => (
                <EqBandFader
                  key={label}
                  label={label}
                  value={eqGains[index] ?? 0}
                  enabled={eqEnabled}
                  onChange={(gain) => setEqBand(index, gain)}
                />
              ))}
            </div>

            <div className="mt-4 flex items-center gap-3 border-t border-line pt-3.5">
              <span className="shrink-0 text-[11px] font-medium tracking-[0.04em] text-t2 uppercase">Pre-amp</span>
              <EqPreampFader value={eqPreamp} onChange={setEqPreamp} />
              <span className="w-[62px] shrink-0 text-right font-mono text-[11px] text-t2">{formatDb(eqPreamp)} dB</span>
            </div>
          </div>

          <p className="mt-3 font-mono text-[11px] leading-normal text-t3">
            Click a fader to set its gain · saved with this player
          </p>
        </div>
      ) : null}
    </div>
  );
}

function EqBandFader({
  label,
  value,
  enabled,
  onChange,
}: {
  label: string;
  value: number;
  enabled: boolean;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pct = pctFromGain(value);
  const isZero = Math.abs(value) < 0.05;
  const fillColor = !enabled ? "var(--lf-t3)" : isZero ? "var(--lf-t2)" : "var(--lf-playing)";
  const gainFg = !enabled || isZero ? "var(--lf-t3)" : "var(--lf-playing)";

  const applyPointer = useCallback(
    (clientY: number) => {
      if (!trackRef.current) return;
      onChange(gainFromVerticalPointer(clientY, trackRef.current));
    },
    [onChange],
  );

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      applyPointer(event.clientY);
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
      <span className="font-mono text-[10px]" style={{ color: gainFg }}>
        {formatDb(value)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`${label} Hz`}
        aria-valuemin={EQ_GAIN_MIN}
        aria-valuemax={EQ_GAIN_MAX}
        aria-valuenow={value}
        aria-valuetext={`${formatDb(value)} dB`}
        onPointerDown={(event) => {
          event.preventDefault();
          draggingRef.current = true;
          applyPointer(event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            onChange(snapEqGain(value + 0.5));
          } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            onChange(snapEqGain(value - 0.5));
          } else if (event.key === "Home") {
            event.preventDefault();
            onChange(0);
          }
        }}
        className="relative h-[132px] w-full cursor-ns-resize touch-none select-none"
      >
        <div className="absolute top-0 bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-sm bg-surf-2" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        <div
          className="absolute left-1/2 w-1 -translate-x-1/2 rounded-sm"
          style={{
            bottom: `${Math.min(pct, 50)}%`,
            height: `${Math.abs(pct - 50)}%`,
            background: fillColor,
          }}
        />
        <div
          className="absolute left-1/2 h-2 w-5 -translate-x-1/2 translate-y-1/2 rounded-[3px] shadow-[var(--lf-art-shadow)]"
          style={{ bottom: `${pct}%`, background: fillColor }}
        />
      </div>
      <span className="font-mono text-[10px] text-t3">{label}</span>
    </div>
  );
}

function EqPreampFader({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pct = pctFromGain(value);

  const applyPointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      onChange(gainFromHorizontalPointer(clientX, trackRef.current));
    },
    [onChange],
  );

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      applyPointer(event.clientX);
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
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label="Pre-amp"
      aria-valuemin={EQ_GAIN_MIN}
      aria-valuemax={EQ_GAIN_MAX}
      aria-valuenow={value}
      aria-valuetext={`${formatDb(value)} dB`}
      onPointerDown={(event) => {
        event.preventDefault();
        draggingRef.current = true;
        applyPointer(event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onChange(snapEqGain(value + 0.5));
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onChange(snapEqGain(value - 0.5));
        } else if (event.key === "Home") {
          event.preventDefault();
          onChange(0);
        }
      }}
      className="relative flex h-5 flex-1 cursor-ew-resize touch-none select-none items-center"
    >
      <div className="h-1 w-full rounded-sm bg-surf-2" />
      <div className="absolute top-0.5 bottom-0.5 left-1/2 w-px bg-line" />
      <div
        className="absolute h-5 w-2 -translate-x-1/2 rounded-[3px] bg-playing"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { camelotColor } from "@/lib/audio/djMatch";
import { useDjStore } from "@/lib/store/dj";
import { camelotKeyName } from "@/lib/tags/camelotKey";
import { CamelotWheelPicker } from "./CamelotWheelPicker";

export function DjTransportControls() {
  const targetBpm = useDjStore((s) => s.targetBpm);
  const targetKey = useDjStore((s) => s.targetKey);
  const targetOctave = useDjStore((s) => s.targetOctave);
  const keyLockEnabled = useDjStore((s) => s.keyLockEnabled);
  const setTargetBpm = useDjStore((s) => s.setTargetBpm);
  const bumpTargetBpm = useDjStore((s) => s.bumpTargetBpm);
  const setTargetKey = useDjStore((s) => s.setTargetKey);
  const bumpTargetOctave = useDjStore((s) => s.bumpTargetOctave);
  const toggleKeyLock = useDjStore((s) => s.toggleKeyLock);

  const octaveLabel = targetOctave === 0 ? "0" : targetOctave > 0 ? `+${targetOctave}` : String(targetOctave);

  const keyStyle = targetKey ? camelotColor(targetKey) : null;

  const [bpmInput, setBpmInput] = useState(targetBpm != null ? String(targetBpm) : "");

  useEffect(() => {
    setBpmInput(targetBpm != null ? String(targetBpm) : "");
  }, [targetBpm]);

  const commitBpmInput = () => {
    const parsed = Number(bpmInput);
    if (bpmInput.trim() === "" || !Number.isFinite(parsed)) {
      setBpmInput(targetBpm != null ? String(targetBpm) : "");
      return;
    }
    setTargetBpm(Math.round(parsed));
  };

  return (
    <div className="lf-top mx-8 mb-6 flex items-stretch rounded-xl border border-line bg-surf">
      {/* Target BPM */}
      <div className="flex w-[250px] flex-none flex-col justify-center gap-3.5 px-6 py-5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-t3">Target BPM</div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => bumpTargetBpm(-1)}
            className="h-8 w-8 flex-none rounded-lg border border-line bg-bg text-base text-t2 hover:border-acc hover:text-t1"
          >
            −
          </button>
          <input
            type="number"
            inputMode="decimal"
            min={20}
            max={400}
            value={bpmInput}
            placeholder="— —"
            onChange={(e) => setBpmInput(e.target.value)}
            onBlur={commitBpmInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setBpmInput(targetBpm != null ? String(targetBpm) : "");
                e.currentTarget.blur();
              }
            }}
            className={`w-full flex-1 rounded-lg border border-line bg-bg py-1 text-center font-mono text-2xl outline-none focus:border-acc ${targetBpm ? "text-t1" : "text-t3"}`}
          />
          <button
            type="button"
            onClick={() => bumpTargetBpm(1)}
            className="h-8 w-8 flex-none rounded-lg border border-line bg-bg text-base text-t2 hover:border-acc hover:text-t1"
          >
            +
          </button>
        </div>
        <div className="font-mono text-[11px] text-t3">{targetBpm ? "tempo range ±6%" : "no target set"}</div>
        {targetBpm == null && (
          <button
            type="button"
            onClick={() => setTargetBpm(120)}
            className="w-fit text-[11px] font-medium text-acc-text hover:underline"
          >
            Set target…
          </button>
        )}
      </div>

      <div className="w-px flex-none bg-line" />

      {/* Target key + octave */}
      <div className="flex flex-1 items-center gap-6 px-6 py-5">
        <CamelotWheelPicker target={targetKey} onPick={setTargetKey} />
        <div className="min-w-0">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-t3">Target key</div>
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`rounded px-2.5 py-[5px] font-mono text-[13px] font-medium ${keyStyle ? "" : "bg-surf-2 text-t3"}`}
              style={keyStyle ? { background: keyStyle.bg, color: keyStyle.fg } : undefined}
            >
              {targetKey ?? "—"}
            </span>
            <span className="text-[13px] text-t2">{targetKey ? camelotKeyName(targetKey) : "not set"}</span>
          </div>
          <div className="max-w-[210px] font-mono text-[11px] leading-relaxed text-t3">
            Outer ring major (B) · inner ring minor (A). Neighbours mix.
          </div>
        </div>
        <div className="ml-auto flex w-[140px] flex-none flex-col justify-center gap-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-t3">Target octave</div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => bumpTargetOctave(-1)}
              disabled={targetOctave <= -2}
              aria-label="Lower target octave"
              className="h-8 w-8 flex-none rounded-lg border border-line bg-bg text-base text-t2 hover:border-acc hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-t2"
            >
              −
            </button>
            <span
              className={`flex-1 rounded-lg border border-line bg-bg py-1 text-center font-mono text-2xl ${targetOctave === 0 ? "text-t3" : "text-t1"}`}
              aria-live="polite"
            >
              {octaveLabel}
            </span>
            <button
              type="button"
              onClick={() => bumpTargetOctave(1)}
              disabled={targetOctave >= 2}
              aria-label="Raise target octave"
              className="h-8 w-8 flex-none rounded-lg border border-line bg-bg text-base text-t2 hover:border-acc hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-t2"
            >
              +
            </button>
          </div>
          <div className="font-mono text-[11px] text-t3">relative to original</div>
        </div>
      </div>

      <div className="w-px flex-none bg-line" />

      {/* Key lock */}
      <div className="flex w-[230px] flex-none flex-col justify-center gap-3 px-6 py-5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-t3">Key lock</div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleKeyLock}
            aria-pressed={keyLockEnabled}
            className="relative h-[26px] w-[46px] flex-none rounded-full p-0"
            style={{
              background: keyLockEnabled ? "var(--lf-acc)" : "var(--lf-surf-2)",
              border: `1px solid ${keyLockEnabled ? "var(--lf-acc)" : "var(--lf-line)"}`,
            }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full transition-[left] duration-150"
              style={{ left: keyLockEnabled ? "22px" : "2px", background: keyLockEnabled ? "var(--lf-on-acc)" : "var(--lf-t3)" }}
            />
          </button>
          <span className={`text-[13px] font-medium ${keyLockEnabled ? "text-t1" : "text-t2"}`}>{keyLockEnabled ? "On" : "Off"}</span>
        </div>
        <div className="font-mono text-[11px] leading-relaxed text-t3">
          {keyLockEnabled ? "Pitch stays fixed while tempo moves." : "Pitch follows tempo, like a vinyl pitch fader."}
        </div>
      </div>
    </div>
  );
}

"use client";

import { camelotColor, camelotWheelPositions } from "@/lib/audio/djMatch";

const WHEEL_POSITIONS = camelotWheelPositions();

export function CamelotWheelPicker({ target, onPick }: { target: string | null; onPick: (key: string) => void }) {
  return (
    <div className="relative h-[236px] w-[236px] flex-none">
      {WHEEL_POSITIONS.map((pos) => {
        const selected = target === pos.key;
        const { bg, fg } = camelotColor(pos.key);
        return (
          <button
            key={pos.key}
            type="button"
            title={pos.title}
            onClick={() => onPick(pos.key)}
            className="absolute left-1/2 top-1/2 grid cursor-pointer place-items-center rounded p-0 font-mono text-[9.5px] font-medium"
            style={{
              width: pos.style.width,
              height: pos.style.height,
              margin: pos.style.margin,
              transform: pos.style.transform,
              background: selected ? bg : `color-mix(in srgb, ${bg} 26%, transparent)`,
              color: selected ? fg : "var(--lf-t2)",
              border: `1px solid ${selected ? "var(--lf-t1)" : "transparent"}`,
            }}
          >
            {pos.label}
          </button>
        );
      })}
      <div className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-bg text-center">
        <div>
          <div className="font-mono text-[15px] leading-[1.1] text-t1">{target ?? "—"}</div>
          <div className="text-[8px] uppercase tracking-wide text-t3">key</div>
        </div>
      </div>
    </div>
  );
}

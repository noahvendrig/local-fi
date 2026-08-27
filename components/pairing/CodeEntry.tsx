"use client";

import { useRef } from "react";

const CODE_LENGTH = 8;

function sanitizeChar(char: string): string {
  return char.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// 8-box manual code entry (design board 1c "m-pair scan" frame's "Enter code instead" card) —
// the guaranteed-to-work pairing path with no camera/secure-context dependency, kept fully
// functional regardless of whether the camera scanner above it can start.
export function CodeEntry({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = value.padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");

  function setCharAt(index: number, char: string) {
    const next = chars.slice();
    next[index] = char || " ";
    onChange(next.join("").trimEnd());
  }

  function handleChange(index: number, raw: string) {
    const sanitized = sanitizeChar(raw.slice(-1));
    setCharAt(index, sanitized);
    if (sanitized && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !chars[index].trim() && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = sanitizeChar(e.clipboardData.getData("text").replace(/[^A-Za-z0-9]/g, ""));
    onChange(pasted.slice(0, CODE_LENGTH));
  }

  return (
    // gap-1.5 + min-w-0 so eight boxes always fit the phone's width — flex items default to
    // `min-width: auto`, and an <input>'s intrinsic preferred width is wide enough that without
    // this the row overflows the viewport and the whole screen scrolls sideways.
    <div className="flex gap-1.5" onPaste={handlePaste}>
      {chars.map((char, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          value={char.trim()}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          inputMode="text"
          autoCapitalize="characters"
          maxLength={1}
          size={1}
          aria-label={`Code character ${index + 1}`}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-bg text-center font-mono text-lg font-medium text-t1 outline-none focus:border-acc"
        />
      ))}
    </div>
  );
}

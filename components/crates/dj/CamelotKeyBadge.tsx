import { camelotColor } from "@/lib/audio/djMatch";

export function CamelotKeyBadge({ camelotKey }: { camelotKey: string }) {
  const { bg, fg } = camelotColor(camelotKey);
  return (
    <span
      className="inline-flex items-center rounded px-2 py-[3px] font-mono text-[11.5px] font-medium"
      style={{ background: bg, color: fg }}
    >
      {camelotKey}
    </span>
  );
}

import type { AiDjPrepStatus } from "@/lib/store/aiDj";

const LABEL: Record<AiDjPrepStatus, string> = {
  idle: "",
  queued: "queued",
  separating: "separating stems…",
  ready: "ready",
  fallback: "plain crossfade",
  failed: "separation failed",
};

const COLOR: Record<AiDjPrepStatus, string> = {
  idle: "var(--lf-t3)",
  queued: "var(--lf-t3)",
  separating: "var(--lf-warn)",
  ready: "var(--lf-ok)",
  fallback: "var(--lf-warn)",
  failed: "var(--lf-err)",
};

/** Small status chip for the AI DJ JIT stem-separation pipeline — shown next to the current/next track. */
export function PrepStatusBadge({ status }: { status: AiDjPrepStatus | undefined }) {
  const resolved = status ?? "idle";
  if (resolved === "idle") return null;
  const spinning = resolved === "queued" || resolved === "separating";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px]" style={{ color: COLOR[resolved] }}>
      {spinning && <span className="lf-index-spin h-[9px] w-[9px] flex-none rounded-full border-[1.5px] border-line border-t-current" />}
      {LABEL[resolved]}
    </span>
  );
}

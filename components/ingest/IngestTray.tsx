"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { collectDroppedFiles } from "@/lib/ingest/collectFiles";
import { useIngestStore } from "@/lib/store/ingest";

/**
 * Global drop listener for the app window. The Import page is the progress UI;
 * this only shows the drag overlay on other routes and always feeds the pipeline.
 */
export function IngestTray() {
  const pathname = usePathname();
  const router = useRouter();
  const isDragActive = useIngestStore((s) => s.isDragActive);
  const setDragActive = useIngestStore((s) => s.setDragActive);
  const submitFiles = useIngestStore((s) => s.submitFiles);
  const setError = useIngestStore((s) => s.setError);
  const dragDepth = useRef(0);

  useEffect(() => {
    function hasFiles(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }
    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragActive(true, e.dataTransfer?.items.length ?? 0);
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragActive(true, e.dataTransfer?.items.length ?? 0);
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    }
    async function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (!e.dataTransfer) return;
      if (pathname !== "/import") router.push("/import");
      const files = await collectDroppedFiles(e.dataTransfer);
      if (files.length === 0) {
        setError("No supported audio files found in that drop.");
        return;
      }
      await submitFiles(files);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [pathname, router, setDragActive, setError, submitFiles]);

  if (!isDragActive || pathname === "/import") return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
      style={{ backgroundColor: "var(--lf-glass, rgba(18,16,22,0.6))" }}
    >
      <div className="rounded-2xl border-[1.5px] border-solid border-acc bg-[var(--lf-tint)] px-10 py-8 text-center shadow-[0_0_0_6px_var(--lf-ring)]">
        <p className="font-serif text-[40px] font-medium leading-[1.1] text-t1">Drop to import</p>
        <p className="mt-3 text-sm text-t2">Audio files and folders are both supported.</p>
        <p className="mt-1.5 font-mono text-xs text-t3">FLAC · ALAC · MP3 · WAV · AIFF · OGG</p>
      </div>
    </div>
  );
}

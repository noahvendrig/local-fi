"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/** Pulls a `code` param out of a scanned pairing URL, or treats the payload as a bare code. */
export function extractCodeFromScan(payload: string): string {
  try {
    const url = new URL(payload);
    const fromQuery = url.searchParams.get("code");
    if (fromQuery) return fromQuery;
  } catch {
    // Not a URL — fall through and treat the raw payload as the code itself.
  }
  return payload;
}

/** Pulls the PC's origin out of a scanned pairing URL — null for a bare code with no address
 *  attached (e.g. the standalone PWA's manual "Server address" fallback is the only way to
 *  pair in that case). Same-origin callers (the existing LAN mobile view) don't need this at
 *  all, since window.location.origin already is the PC. */
export function extractOriginFromScan(payload: string): string | null {
  try {
    return new URL(payload).origin;
  } catch {
    return null;
  }
}

// Live camera QR viewfinder (design board 1c "m-pair scan" frame) — for re-pairing from inside
// an already-installed PWA. getUserMedia requires a secure context (HTTPS, or localhost), which
// a plain LAN address is not, so this degrades to a status message rather than blocking the
// screen: CodeEntry alongside it is the guaranteed-to-work path either way, per the design's own
// "type the code manually if the camera can't read the QR" framing.
export function QrScanner({ onScan }: { onScan: (payload: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPayloadRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "unavailable">("starting");

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus("scanning");
        scanLoop();
      } catch {
        setStatus("unavailable");
      }
    }

    function scanLoop() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      // Gate on videoWidth, not `readyState === HAVE_ENOUGH_DATA` (4): mobile Safari/Chrome keep
      // a perfectly-playing camera stream at readyState 2–3 indefinitely, so the old check left
      // the loop spinning forever without ever grabbing a frame — the camera showed but nothing
      // scanned.
      if (!video || !canvas || !video.videoWidth || video.readyState < video.HAVE_CURRENT_DATA) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }
      // Downscale to a ~640px working frame — jsQR is a synchronous CPU decode and running it on
      // a full 1080p+ phone frame every tick janks hard enough to miss the code.
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(frame.data, frame.width, frame.height);
      if (result?.data && result.data !== lastPayloadRef.current) {
        // Keep scanning after a hit rather than freezing the loop: if the parent's pairing
        // attempt fails, holding the same QR back up should retry. Suppress only immediate
        // duplicate frames of the same payload so we don't fire onScan 60×/sec.
        lastPayloadRef.current = result.data;
        onScan(result.data);
        setTimeout(() => {
          lastPayloadRef.current = null;
        }, 2000);
      }
      rafRef.current = requestAnimationFrame(scanLoop);
    }

    start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onScan is passed fresh each render; re-running the effect on it would restart the camera
  }, []);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-[20px] border border-line bg-surf-2">
      <video ref={videoRef} className={`h-full w-full object-cover ${status === "scanning" ? "" : "invisible"}`} muted playsInline />
      <canvas ref={canvasRef} className="hidden" />
      {status !== "scanning" ? (
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <p className="font-mono text-xs text-t3">
            {status === "starting" ? "Starting camera…" : "Camera unavailable — enter the code below"}
          </p>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-acc/70" aria-hidden />
      )}
    </div>
  );
}

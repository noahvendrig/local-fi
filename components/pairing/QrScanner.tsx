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
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        rafRef.current = requestAnimationFrame(scanLoop);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(frame.data, frame.width, frame.height);
      if (result?.data) {
        onScan(result.data);
        return; // stop the loop — the parent unmounts this on a successful scan
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

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { bootstrapDataDir } = await import("./lib/storage/dataDir");
  const { getAuthToken } = await import("./lib/auth/token");
  const { getDb } = await import("./lib/db/client");
  const { isFfmpegAvailable } = await import("./lib/ffmpeg");
  const { sweepStaleImports } = await import("./lib/import/sweep");
  const { sweepExpiredTrash } = await import("./lib/library/trash");
  const { startAllWatchers } = await import("./lib/library/watcher");

  bootstrapDataDir();
  getAuthToken();
  getDb();
  sweepStaleImports();
  sweepExpiredTrash();
  startAllWatchers();

  if (!isFfmpegAvailable()) {
    console.warn(
      "[local-fi] ffmpeg was not found on PATH — import/waveform generation will be disabled until it's installed. " +
        "Set LOCALFI_FFMPEG_PATH to point at a specific binary instead."
    );
  }
}

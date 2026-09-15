import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

let child: ChildProcess | null = null;
let signalsRegistered = false;

export function getPythonBackendDir(): string {
  return path.join(process.cwd(), "python-backend");
}

export function getPythonBackendPort(): number {
  return Number(process.env.LOCALFI_PYTHON_BACKEND_PORT) || 8765;
}

export function getPythonBackendUrl(): string {
  return `http://127.0.0.1:${getPythonBackendPort()}`;
}

/** Resolved Python interpreter — prefers python-backend's own venv, falls back to "python" on PATH. Override with LOCALFI_PYTHON_PATH (same convention as LOCALFI_FFMPEG_PATH in lib/ffmpeg.ts). */
export function getPythonPath(): string {
  if (process.env.LOCALFI_PYTHON_PATH) return process.env.LOCALFI_PYTHON_PATH;
  const venvPython = path.join(
    getPythonBackendDir(),
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python"
  );
  return existsSync(venvPython) ? venvPython : "python";
}

export async function isPythonBackendAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${getPythonBackendUrl()}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Spawns the Python backend if nothing is already answering on its port — safe to
 * call once at startup. Never throws: a missing/misconfigured Python setup just
 * disables Spotify import, the same non-fatal treatment lib/ffmpeg.ts gives a
 * missing ffmpeg. Not `detached`, so the child dies with this Node process; the
 * process-exit handlers below are a Windows-safety-net on top of that.
 */
export async function startPythonBackend(): Promise<void> {
  if (await isPythonBackendAvailable()) return; // already running — orphaned process or a previous dev-server instance

  const backendDir = getPythonBackendDir();
  if (!existsSync(path.join(backendDir, "main.py"))) {
    console.warn("[local-fi] python-backend/ not found — Spotify playlist import will be unavailable.");
    return;
  }

  const pythonPath = getPythonPath();
  const port = getPythonBackendPort();

  const proc = spawn(pythonPath, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: backendDir,
    stdio: "inherit",
  });
  child = proc;

  proc.on("error", (err) => {
    console.warn(
      `[local-fi] Could not start the Python backend (${pythonPath}): ${err.message}. ` +
        "Spotify playlist import will be unavailable until it's set up — see python-backend/requirements.txt, " +
        "or set LOCALFI_PYTHON_PATH to point at a specific interpreter."
    );
    if (child === proc) child = null;
  });

  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[local-fi] Python backend exited unexpectedly (code ${code}).`);
    }
    if (child === proc) child = null;
  });

  if (!signalsRegistered) {
    signalsRegistered = true;
    for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        if (child && !child.killed) child.kill();
      });
    }
  }
}

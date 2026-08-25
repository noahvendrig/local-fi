import { readdir } from "node:fs/promises";
import path from "node:path";
import { isAudioFilePath } from "./audioExtensions";

/** Recursively lists every supported audio file under `rootAbsPath`. Best-effort: an unreadable subdirectory (permissions, a broken junction) is skipped, not fatal. */
export async function walkAudioFiles(rootAbsPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isAudioFilePath(entry.name)) {
        results.push(full);
      }
    }
  }

  await walk(rootAbsPath);
  return results;
}

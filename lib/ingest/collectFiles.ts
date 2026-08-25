// Client-side pre-filter only — the server is the real authority on what's
// importable (ARCHITECTURE.md §3.1). This just keeps obvious non-audio junk
// (.DS_Store, playlist files, etc.) out of the upload batch.
const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".aac", ".m4a", ".ogg", ".oga", ".opus", ".aif", ".aiff", ".webm"];

/** A file paired with its path relative to the folder the user chose to import, e.g. "Imported Folder/Album A/track.mp3". */
export interface CollectedFile {
  file: File;
  relativePath: string;
}

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function readEntryAsFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, out: CollectedFile[]): Promise<void> {
  if (entry.isFile) {
    if (isAudioFile(entry.name)) {
      const file = await readEntryAsFile(entry as FileSystemFileEntry);
      out.push({ file, relativePath: entry.fullPath.replace(/^\/+/, "") });
    }
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await readDirectoryEntries(reader);
      for (const child of batch) await walkEntry(child, out);
    } while (batch.length > 0);
  }
}

/** Recursively expands dropped files/folders (drag-and-drop of a folder uses the webkit entries API). */
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<CollectedFile[]> {
  const items = Array.from(dataTransfer.items);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry != null);

  if (entries.length === 0) {
    // Fallback for browsers/contexts without the entries API — flat file list only.
    return Array.from(dataTransfer.files)
      .filter((f) => isAudioFile(f.name))
      .map((file) => ({ file, relativePath: file.name }));
  }

  const out: CollectedFile[] = [];
  for (const entry of entries) await walkEntry(entry, out);
  return out;
}

/** Filters a `<input webkitdirectory>` file list down to audio files, keeping each file's folder-relative path. */
export function filterAudioFiles(files: FileList | File[]): CollectedFile[] {
  return Array.from(files)
    .filter((f) => isAudioFile(f.name))
    .map((file) => ({ file, relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
}

/**
 * True when the collected files span more than one immediate subfolder of the
 * imported root (or sit alongside one) — i.e. there's a real "which subfolder did
 * this come from" question to ask the user about (AGENTS.md import behavior).
 */
export function hasSubfolders(files: CollectedFile[]): boolean {
  return files.some((f) => sourceFolderOf(f) != null);
}

/** Mirrors the server's grouping in lib/import/folderPlaylists.ts, for client-side detection only. */
export function sourceFolderOf(file: CollectedFile): string | null {
  const segments = file.relativePath.split("/").filter(Boolean);
  return segments.length > 2 ? segments[1] : null;
}

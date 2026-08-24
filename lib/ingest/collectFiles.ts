// Client-side pre-filter only — the server is the real authority on what's
// importable (ARCHITECTURE.md §3.1). This just keeps obvious non-audio junk
// (.DS_Store, playlist files, etc.) out of the upload batch.
const AUDIO_EXTENSIONS = [".mp3", ".flac", ".wav", ".aac", ".m4a", ".ogg", ".oga", ".aif", ".aiff"];

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

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    if (isAudioFile(entry.name)) {
      out.push(await readEntryAsFile(entry as FileSystemFileEntry));
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
export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry != null);

  if (entries.length === 0) {
    // Fallback for browsers/contexts without the entries API — flat file list only.
    return Array.from(dataTransfer.files).filter((f) => isAudioFile(f.name));
  }

  const out: File[] = [];
  for (const entry of entries) await walkEntry(entry, out);
  return out;
}

export function filterAudioFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((f) => isAudioFile(f.name));
}

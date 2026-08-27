import {
  deleteOfflineCrateRecord,
  getOfflineCrate,
  putOfflineCrate,
  type OfflineCrate,
} from "./db";

// Local crate ids are negative, seeded from the clock, exactly like local-only track ids
// (lib/offline/localImport.ts) — they share the same numeric id space as copied crates (real
// server playlist ids, always positive) without ever colliding, so every list that already
// keys crates by `id: number` needs no "is this local" branch.
let localIdCounter = 0;
function generateLocalCrateId(): number {
  localIdCounter += 1;
  return -(Date.now() * 1000 + localIdCounter);
}

function isLocal(crate: OfflineCrate | undefined): crate is OfflineCrate {
  return crate != null && crate.origin === "local";
}

/** Makes an empty phone-only crate. Standalone build only — there's no PC round-trip. */
export async function createLocalCrate(name: string): Promise<OfflineCrate> {
  const now = new Date().toISOString();
  const crate: OfflineCrate = {
    id: generateLocalCrateId(),
    name: name.trim(),
    trackIds: [],
    copiedAt: now,
    origin: "local",
    updatedAt: now,
  };
  await putOfflineCrate(crate);
  return crate;
}

export async function renameLocalCrate(id: number, name: string): Promise<void> {
  const crate = await getOfflineCrate(id);
  if (!isLocal(crate) || !name.trim()) return;
  await putOfflineCrate({ ...crate, name: name.trim(), updatedAt: new Date().toISOString() });
}

/** Appends tracks (server-backed or local-only ids both fine), skipping any already present. */
export async function addTracksToLocalCrate(id: number, trackIds: number[]): Promise<void> {
  const crate = await getOfflineCrate(id);
  if (!isLocal(crate)) return;
  const merged = crate.trackIds.slice();
  for (const trackId of trackIds) {
    if (!merged.includes(trackId)) merged.push(trackId);
  }
  await putOfflineCrate({ ...crate, trackIds: merged, updatedAt: new Date().toISOString() });
}

export async function removeTrackFromLocalCrate(id: number, trackId: number): Promise<void> {
  const crate = await getOfflineCrate(id);
  if (!isLocal(crate)) return;
  await putOfflineCrate({
    ...crate,
    trackIds: crate.trackIds.filter((t) => t !== trackId),
    updatedAt: new Date().toISOString(),
  });
}

/** Drops the crate record only — its tracks stay in "All songs", they were never its to delete. */
export async function deleteLocalCrate(id: number): Promise<void> {
  const crate = await getOfflineCrate(id);
  if (!isLocal(crate)) return;
  await deleteOfflineCrateRecord(id);
}

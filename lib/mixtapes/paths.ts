import path from "node:path";
import { getDataDir } from "../storage/dataDir";
import { shardOf } from "../import/paths";

/** Uploaded mixtape audio lives at mixtapes/<shard>/<uuid>/<sanitized-filename> — same sharded
 *  layout as originalsDirFor, separate top-level dir since a mixtape isn't library content. */
export function mixtapeDirFor(uuid: string): string {
  return path.join(getDataDir(), "mixtapes", shardOf(uuid), uuid);
}

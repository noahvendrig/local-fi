import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { bootstrapDataDir, getDbPath } from "../storage/dataDir";
import * as schema from "./schema";

let sqlite: Database.Database | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Opens (or returns the cached) SQLite connection in WAL mode and applies pending migrations. */
export function getDb() {
  if (dbInstance) return dbInstance;

  bootstrapDataDir();
  sqlite = new Database(getDbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  dbInstance = drizzle(sqlite, { schema });
  migrate(dbInstance, { migrationsFolder: path.join(process.cwd(), "lib/db/migrations") });

  return dbInstance;
}

/** True if a trivial query against the DB succeeds. Used by the health check. */
export function isDbReachable(): boolean {
  try {
    getDb().$client.prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

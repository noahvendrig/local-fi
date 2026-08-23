import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { bootstrapDataDir, getAuthTokenPath } from "../storage/dataDir";

// Loaded once per process, per ARCHITECTURE.md §8.
let cachedToken: string | null = null;

/** Returns the bearer token, generating and persisting one on first run. */
export function getAuthToken(): string {
  if (cachedToken) return cachedToken;

  if (process.env.LOCALFI_AUTH_TOKEN) {
    cachedToken = process.env.LOCALFI_AUTH_TOKEN;
    return cachedToken;
  }

  bootstrapDataDir();
  const tokenPath = getAuthTokenPath();
  if (existsSync(tokenPath)) {
    cachedToken = readFileSync(tokenPath, "utf8").trim();
  } else {
    cachedToken = randomBytes(32).toString("hex");
    writeFileSync(tokenPath, cachedToken, "utf8");
  }
  return cachedToken;
}

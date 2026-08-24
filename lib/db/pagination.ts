import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

export type SortDirection = "asc" | "desc";

export interface DecodedCursor {
  v: string | number;
  id: number;
}

/** Opaque cursor encoding (sortValue, id) — ARCHITECTURE.md §7's `(sortValue, id)` scheme. */
export function encodeCursor(value: string | number, id: number): string {
  return Buffer.from(JSON.stringify({ v: value, id })).toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): DecodedCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if ((typeof parsed?.v !== "string" && typeof parsed?.v !== "number") || typeof parsed?.id !== "number") {
      return null;
    }
    return { v: parsed.v, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * `(sortExpr, id) < (cursorValue, cursorId)` (or `>` for ascending order), the standard
 * keyset-pagination predicate — avoids the skipped/duplicated rows offset pagination gets
 * when rows are inserted mid-scroll during an active import (ARCHITECTURE.md §7).
 */
export function cursorCondition(
  sortExpr: SQLWrapper,
  idCol: SQLiteColumn,
  cursorValue: string | number,
  cursorId: number,
  dir: SortDirection
): SQL {
  const op = dir === "desc" ? sql.raw("<") : sql.raw(">");
  return sql`((${sortExpr} ${op} ${cursorValue}) OR (${sortExpr} = ${cursorValue} AND ${idCol} ${op} ${cursorId}))`;
}

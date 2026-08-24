import type { playlists } from "@/lib/db/schema";
import type { RuleGroup } from "./rules";

export interface PlaylistJson {
  id: number;
  uuid: string;
  name: string;
  type: "manual" | "smart";
  description: string | null;
  rulesJson: RuleGroup | null;
  sortField: string | null;
  coverArtUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPlaylistJson(row: typeof playlists.$inferSelect): PlaylistJson {
  return {
    id: row.id,
    uuid: row.uuid,
    name: row.name,
    type: row.type as "manual" | "smart",
    description: row.description,
    rulesJson: row.rulesJson ? (JSON.parse(row.rulesJson) as RuleGroup) : null,
    sortField: row.sortField,
    coverArtUrl: row.coverArtPath ? `/api/v1/playlists/${row.id}/cover` : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

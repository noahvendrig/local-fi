import { RULE_FIELD_KIND, type RuleCondition, type RuleField, type RuleOp } from "./rules";

export const FIELD_LABELS: Record<RuleField, string> = {
  format: "Format",
  lossless: "Lossless",
  genre: "Genre",
  artist: "Artist",
  albumArtist: "Album Artist",
  album: "Album",
  year: "Year",
  dateAdded: "Added",
  bitrate: "Bitrate",
  sampleRate: "Sample Rate",
  durationSeconds: "Duration",
  playCount: "Play Count",
  lastPlayedAt: "Last Played",
};

export const OP_LABELS: Record<RuleOp, string> = {
  eq: "is",
  neq: "is not",
  in: "is one of",
  not_in: "is not one of",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  within_days: "is within the last",
  before: "is before",
  after: "is after",
};

/** A fresh, internally-consistent condition for a newly-picked field. */
export function defaultConditionForField(field: RuleField): RuleCondition {
  switch (RULE_FIELD_KIND[field]) {
    case "boolean":
      return { field, op: "eq", value: true };
    case "number":
      return { field, op: "eq", value: field === "year" ? new Date().getFullYear() : 0 };
    case "date":
      return { field, op: "within_days", value: 30 };
    case "string":
    default:
      return { field, op: "eq", value: "" };
  }
}

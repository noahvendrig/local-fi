import { z } from "zod";

// Smart-crate rule tree (ARCHITECTURE.md §3.4) — a small recursive condition tree.
// { match: "all" | "any", conditions: (Condition | Group)[] }, nestable groups.

export const RULE_FIELDS = [
  "format",
  "lossless",
  "genre",
  "artist",
  "albumArtist",
  "album",
  "year",
  "dateAdded",
  "bitrate",
  "sampleRate",
  "durationSeconds",
  "playCount",
  "lastPlayedAt",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_OPS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "contains", "within_days", "before", "after"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export type RuleFieldKind = "string" | "number" | "boolean" | "date";

export const RULE_FIELD_KIND: Record<RuleField, RuleFieldKind> = {
  format: "string",
  genre: "string",
  artist: "string",
  albumArtist: "string",
  album: "string",
  lossless: "boolean",
  year: "number",
  bitrate: "number",
  sampleRate: "number",
  durationSeconds: "number",
  playCount: "number",
  dateAdded: "date",
  lastPlayedAt: "date",
};

/** Which ops are semantically valid per field kind — "gt can't be applied to a string field" (§3.4). */
export const RULE_OPS_BY_KIND: Record<RuleFieldKind, RuleOp[]> = {
  string: ["eq", "neq", "in", "not_in", "contains"],
  number: ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte"],
  boolean: ["eq", "neq"],
  date: ["eq", "neq", "within_days", "before", "after"],
};

const RuleConditionSchema = z
  .object({
    field: z.enum(RULE_FIELDS),
    op: z.enum(RULE_OPS),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  })
  .superRefine((cond, ctx) => {
    const kind = RULE_FIELD_KIND[cond.field];
    if (!RULE_OPS_BY_KIND[kind].includes(cond.op)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op "${cond.op}" is not valid for field "${cond.field}" (a ${kind} field).` });
      return;
    }

    if (cond.op === "in" || cond.op === "not_in") {
      if (!Array.isArray(cond.value) || cond.value.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op "${cond.op}" requires a non-empty array value.` });
      }
      return;
    }

    if (cond.op === "within_days") {
      if (typeof cond.value !== "number") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op "within_days" requires a numeric value (days).` });
      }
      return;
    }

    if (kind === "boolean" && typeof cond.value !== "boolean") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${cond.field}" requires a boolean value.` });
    } else if (kind === "number" && typeof cond.value !== "number") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${cond.field}" requires a numeric value.` });
    } else if ((kind === "string" || kind === "date") && typeof cond.value !== "string") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${cond.field}" requires a string value.` });
    }
  });

export type RuleCondition = z.infer<typeof RuleConditionSchema>;

export interface RuleGroup {
  match: "all" | "any";
  conditions: RuleNode[];
}
export type RuleNode = RuleCondition | RuleGroup;

export function isRuleGroup(node: RuleNode): node is RuleGroup {
  return "match" in node;
}

// z.lazy needs an explicit type annotation to break the circular inference.
export const RuleGroupSchema: z.ZodType<RuleGroup> = z.lazy(() =>
  z.object({
    match: z.enum(["all", "any"]),
    conditions: z.array(z.union([RuleConditionSchema, RuleGroupSchema])),
  })
);

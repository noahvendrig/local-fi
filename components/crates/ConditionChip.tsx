"use client";

import { RULE_FIELDS, RULE_FIELD_KIND, RULE_OPS_BY_KIND, type RuleCondition, type RuleField, type RuleOp } from "@/lib/crates/rules";
import { FIELD_LABELS, OP_LABELS, defaultConditionForField } from "@/lib/crates/labels";

const selectClass = "rounded-md border border-line bg-surf px-2 py-1 text-xs text-t1";
const inputClass = "w-28 rounded-md border border-line bg-surf px-2 py-1 text-xs text-t1";

export function ConditionChip({
  condition,
  onChange,
  onRemove,
}: {
  condition: RuleCondition;
  onChange: (next: RuleCondition) => void;
  onRemove: () => void;
}) {
  const kind = RULE_FIELD_KIND[condition.field];
  const allowedOps = RULE_OPS_BY_KIND[kind];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-playing bg-[var(--lf-tint)] px-3.5 py-3">
      <select
        value={condition.field}
        onChange={(e) => onChange(defaultConditionForField(e.target.value as RuleField))}
        className={selectClass}
      >
        {RULE_FIELDS.map((field) => (
          <option key={field} value={field}>
            {FIELD_LABELS[field]}
          </option>
        ))}
      </select>

      <select
        value={condition.op}
        onChange={(e) => onChange({ ...condition, op: e.target.value as RuleOp } as RuleCondition)}
        className={selectClass}
      >
        {allowedOps.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>

      <ValueInput condition={condition} onChange={onChange} />
      {condition.op === "within_days" && <span className="text-xs text-t3">days</span>}

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove condition"
        className="ml-auto flex h-5 w-5 items-center justify-center rounded text-t3 hover:bg-surf hover:text-err"
      >
        ×
      </button>
    </div>
  );
}

function ValueInput({ condition, onChange }: { condition: RuleCondition; onChange: (next: RuleCondition) => void }) {
  const kind = RULE_FIELD_KIND[condition.field];

  if (condition.op === "in" || condition.op === "not_in") {
    const text = Array.isArray(condition.value) ? condition.value.join(", ") : "";
    return (
      <input
        type="text"
        value={text}
        placeholder="comma, separated"
        onChange={(e) => {
          const list = e.target.value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
            .map((v) => (kind === "number" ? Number(v) : v));
          onChange({ ...condition, value: list } as RuleCondition);
        }}
        className={inputClass}
      />
    );
  }

  if (kind === "boolean") {
    return (
      <select
        value={String(condition.value)}
        onChange={(e) => onChange({ ...condition, value: e.target.value === "true" } as RuleCondition)}
        className={selectClass}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  if (condition.op === "within_days") {
    return (
      <input
        type="number"
        min={0}
        value={typeof condition.value === "number" ? condition.value : 0}
        onChange={(e) => onChange({ ...condition, value: Number(e.target.value) } as RuleCondition)}
        className="w-16 rounded-md border border-line bg-surf px-2 py-1 text-xs text-t1"
      />
    );
  }

  if (kind === "date") {
    return (
      <input
        type="date"
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(e) => onChange({ ...condition, value: e.target.value } as RuleCondition)}
        className={inputClass}
      />
    );
  }

  if (kind === "number") {
    return (
      <input
        type="number"
        value={typeof condition.value === "number" ? condition.value : 0}
        onChange={(e) => onChange({ ...condition, value: Number(e.target.value) } as RuleCondition)}
        className={inputClass}
      />
    );
  }

  return (
    <input
      type="text"
      value={typeof condition.value === "string" ? condition.value : ""}
      onChange={(e) => onChange({ ...condition, value: e.target.value } as RuleCondition)}
      className={inputClass}
    />
  );
}

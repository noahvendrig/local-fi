"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { previewRules, updatePlaylist, type PlaylistDetail } from "@/lib/api/playlistsClient";
import type { TrackSummary } from "@/lib/api-client";
import type { RuleCondition, RuleGroup } from "@/lib/crates/rules";
import { defaultConditionForField } from "@/lib/crates/labels";
import { TrackList } from "@/components/library/TrackList";
import { ConditionChip } from "./ConditionChip";

// UI scope: a single flat list of conditions under one match mode. The backend compiler
// (lib/crates/compileRules.ts) supports full nested groups per ARCHITECTURE.md §3.4; a
// nested-group builder is more UI than this milestone's demoable bar calls for.
function flattenToConditions(rules: RuleGroup): RuleCondition[] {
  return rules.conditions.filter((c): c is RuleCondition => !("match" in c));
}

export function SmartCrateBuilder({ playlist }: { playlist: PlaylistDetail }) {
  const queryClient = useQueryClient();
  const initial = playlist.rulesJson ?? { match: "all", conditions: [] };

  const [match, setMatch] = useState<"all" | "any">(initial.match);
  const [conditions, setConditions] = useState<RuleCondition[]>(flattenToConditions(initial));
  const [preview, setPreview] = useState<TrackSummary[]>(playlist.tracks);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsPreviewing(true);
      previewRules(playlist.id, { match, conditions })
        .then((res) => setPreview(res.items))
        .catch(() => {})
        .finally(() => setIsPreviewing(false));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-preview whenever the rule shape changes
  }, [match, JSON.stringify(conditions)]);

  const saveMutation = useMutation({
    mutationFn: () => updatePlaylist(playlist.id, { rulesJson: { match, conditions } }),
    onSuccess: () => {
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      queryClient.invalidateQueries({ queryKey: ["playlist", playlist.id] });
    },
  });

  const setMatchDirty = (next: "all" | "any") => {
    setMatch(next);
    setIsDirty(true);
  };
  const updateCondition = (index: number, next: RuleCondition) => {
    setConditions((prev) => prev.map((c, i) => (i === index ? next : c)));
    setIsDirty(true);
  };
  const removeCondition = (index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
  };
  const addCondition = () => {
    setConditions((prev) => [...prev, defaultConditionForField("lossless")]);
    setIsDirty(true);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-t2">Match</span>
        <select
          value={match}
          onChange={(e) => setMatchDirty(e.target.value as "all" | "any")}
          className="rounded-md border border-line bg-surf px-2 py-1 text-xs text-t1"
        >
          <option value="all">All conditions</option>
          <option value="any">Any condition</option>
        </select>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {conditions.map((cond, i) => (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && <span className="w-8 shrink-0 text-right text-xs font-medium text-t3">{match === "all" ? "AND" : "OR"}</span>}
            <div className="flex-1">
              <ConditionChip condition={cond} onChange={(next) => updateCondition(i, next)} onRemove={() => removeCondition(i)} />
            </div>
          </div>
        ))}
        {conditions.length === 0 && <p className="text-sm text-t3">No conditions yet — this crate currently matches the whole library.</p>}
      </div>

      <button
        type="button"
        onClick={addCondition}
        className="mt-3 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-t1 hover:bg-surf-2"
      >
        + Add condition
      </button>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={!isDirty || saveMutation.isPending}
          className="rounded-full bg-acc px-4 py-2 text-sm font-medium text-[var(--lf-on-acc)] hover:bg-acc-2 disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving…" : "Save crate"}
        </button>
        {isDirty && !saveMutation.isPending && <span className="text-xs text-t3">Unsaved changes</span>}
        {!isDirty && saveMutation.isSuccess && <span className="text-xs text-ok">Saved</span>}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-t3">Matches {isPreviewing ? "…" : `(${preview.length})`}</p>
        {preview.length === 0 && !isPreviewing ? (
          <p className="text-sm text-t3">No tracks match these conditions.</p>
        ) : (
          <TrackList tracks={preview} />
        )}
      </div>
    </div>
  );
}

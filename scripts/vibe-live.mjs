/**
 * End-to-end check for /api/v1/vibe/select against a running `next dev` (plus Ollama and the
 * Python backend). Complements scripts/vibe-eval.mts, which covers the pure core offline.
 *
 *   node scripts/vibe-live.mjs
 *
 * This is the only way to exercise the parts the offline harness stubs: the real Stage A model, the
 * real embedding expansion, and the cached-filter path used by every replenishment batch after the
 * first. Assertions are deliberately loose where an LLM is involved -- the hard constraints are
 * asserted strictly, the curation is printed for eyeballing.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.LOCALFI_BASE_URL ?? "http://127.0.0.1:3000";
const token = readFileSync("data/auth-token", "utf8").trim();

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`   ${condition ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function pickModel() {
  const res = await fetch(`${BASE}/api/v1/ollama/status`, { headers: { Authorization: `Bearer ${token}` } });
  const status = await res.json();
  if (!status.available || status.models.length === 0) throw new Error("Ollama unavailable or no models installed.");
  return status.models[0];
}

async function select(prompt, opts) {
  const res = await fetch(`${BASE}/api/v1/vibe/select`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, ...opts }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const show = (r) =>
  r.tracks.map((t) => `${t.artistName ?? "?"} — ${t.title ?? "?"}`).slice(0, 8).join("\n      ");

const model = await pickModel();
console.log(`model: ${model}\n`);

for (const prompt of ["90s hiphop", "justin bieber", "drum and bass", "songs for a rainy 2am drive"]) {
  console.log(`\n=== ${JSON.stringify(prompt)} ===`);
  const started = Date.now();
  const first = await select(prompt, { model, limit: 12, sessionId: "live" });
  const { artistIds, era, genres, keywords, hasHardConstraint, source } = first.resolved;
  console.log(`   resolved: artists=${JSON.stringify(artistIds)} era=${JSON.stringify(era)} genres=${JSON.stringify(genres)} keywords=${JSON.stringify(keywords)} source=${source}`);
  console.log(`   tier=${first.tier} counts=${JSON.stringify(first.tierCounts)} usedFallback=${first.usedFallback} ${Date.now() - started}ms`);
  console.log(`   batch 1:\n      ${show(first)}`);
  check("returned tracks", first.tracks.length > 0);

  // The two reported bugs, asserted end-to-end through the real stack.
  if (prompt === "90s hiphop") {
    check("era is hard 1990-1999", era?.min === 1990 && era?.max === 1999, JSON.stringify(era));
    check("hasHardConstraint", hasHardConstraint === true);
  }
  if (prompt === "justin bieber") {
    check("resolved exactly one artist", artistIds.length === 1, JSON.stringify(artistIds));
    check("first track is by Justin Bieber", first.tracks[0]?.artistName === "Justin Bieber", first.tracks[0]?.artistName ?? "none");
  }

  // Batch 2 replays the cached filter with batch 1 excluded -- the path that used to collapse.
  const excludeIds = first.tracks.map((t) => t.id);
  const t2 = Date.now();
  const second = await select(prompt, { model, limit: 12, sessionId: "live", resolved: first.resolved, useStageB: false, excludeIds });
  console.log(`   batch 2: tier=${second.tier} counts=${JSON.stringify(second.tierCounts)} ${Date.now() - t2}ms`);
  console.log(`      ${show(second)}`);
  check("batch 2 returned tracks", second.tracks.length > 0);
  check("batch 2 repeats nothing", second.tracks.every((t) => !excludeIds.includes(t.id)));
  check("batch 2 skipped Stage A (no extra Ollama call)", Date.now() - t2 < 5000, `${Date.now() - t2}ms`);
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);

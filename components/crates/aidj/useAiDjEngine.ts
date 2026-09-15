"use client";

import { useEffect, useState } from "react";
import { streamUrl } from "@/lib/api-client";
import { aiDjStemAudioUrl, cancelAiDjStemsJob, fetchAiDjDeviceInfo, postAiDjStemsJob, watchAiDjStemsJob } from "@/lib/api/aiDjClient";
import type { PlaylistTrackItem } from "@/lib/api/playlistsClient";
import { fetchBeatGrid } from "@/lib/api/tracksClient";
import { equalPowerInCurve, equalPowerOutCurve } from "@/lib/audio/crossfade";
import { decodeStemBuffer } from "@/lib/audio/decodeStemBuffer";
import { getPlaybackEqualizer } from "@/lib/audio/equalizer";
import { findLoopSection, sumAudioBuffers, type LoopSection } from "@/lib/audio/loopPointDetect";
import { computeTransitionPlan, type TransitionPlan, type TransitionTrackInfo } from "@/lib/audio/transitionPlan";
import { transposeCamelotKey } from "@/lib/tags/camelotKey";
import { useAiDjStore, type AiDjPrepStatus } from "@/lib/store/aiDj";
import { useDjStore } from "@/lib/store/dj";
import { useMixtapePlayerStore } from "@/lib/store/mixtapePlayer";
import { usePlayerStore } from "@/lib/store/player";
import { useTransportSourceStore } from "@/lib/store/transportSource";

/** How long before a transition's bar-aligned start we give up waiting on stem separation and
 *  commit to a plain crossfade instead — the transition must never stall or gap. */
const DEADLINE_LEAD_SEC = 20;
/** Duration of the Plan-B fallback: a plain equal-power whole-track crossfade, no beatmatching. */
const FALLBACK_CROSSFADE_SEC = 6;
/** Small pad so a track's very first schedule (or a cold restart) always lands comfortably in
 *  the AudioContext's future, never at/behind currentTime. */
const START_PAD_SEC = 0.15;

interface PrepEntry {
  status: AiDjPrepStatus;
  vocalsBuffer: AudioBuffer | null;
  instrumentalBuffer: AudioBuffer | null;
  fullBuffer: AudioBuffer | null;
  jobId: string | null;
}

interface StemHandles {
  vocals: string;
  instrumental: string;
}

interface FullHandle {
  full: string;
}

interface CurrentRuntime {
  track: PlaylistTrackItem;
  index: number;
  handles: StemHandles | FullHandle;
  /** Anchor for mapping AudioContext time to this track's own, native-file-timeline position:
   *  nativePos(t) = anchorPosition + (t - anchorContextTime) * tempoRatio. tempoRatio is this
   *  track's permanent targetBpm/ownBpm stretch factor — every AI DJ track is locked to the same
   *  session-wide tempo for its whole playing lifetime, so there's no separate "settled" rate. */
  anchorPosition: number;
  anchorContextTime: number;
  tempoRatio: number;
  /** Permanent semitone shift already applied to this track (see chooseKeyShift in
   *  transitionPlan.ts) — needed to work out its *effective* key when planning the next transition. */
  pitchSemitones: number;
  timers: number[];
}

function emptyPrepEntry(): PrepEntry {
  return { status: "idle", vocalsBuffer: null, instrumentalBuffer: null, fullBuffer: null, jobId: null };
}

function isFullHandle(handles: StemHandles | FullHandle): handles is FullHandle {
  return "full" in handles;
}

/** Pause/resume/toggle only ever touch the shared AudioContext singleton + the shared store, so
 *  they're exposed as free functions TransportBar can call without holding a reference to the
 *  per-route engine controller instance. */
export function pauseAiDjPlayback(): void {
  const ctx = getPlaybackEqualizer().ensureAudioContext();
  if (ctx) void ctx.suspend();
  useAiDjStore.getState().setPlaying(false);
}

export function resumeAiDjPlayback(): void {
  void getPlaybackEqualizer().resume();
  useAiDjStore.getState().setPlaying(true);
}

/**
 * Drives one AI DJ session end-to-end: sequencing was already done by the caller
 * (sequenceCrateForAiDj), so this just plays through `order`, running the JIT background stem-
 * separation pipeline for whichever track is next while the current one plays, and scheduling a
 * beatmatched stem-mashup transition (or a plain crossfade fallback if prep doesn't finish in
 * time) between each pair. One controller instance per mounted AI DJ route — see useAiDjEngine
 * below. All scheduling math lives here; transitionPlan.ts stays pure/synchronous.
 *
 * Every track in the set is locked to one session-wide tempo (targetBpm, chosen by the user at
 * session start) — see CurrentRuntime.tempoRatio — and each transition's incoming track is only
 * pitch-shifted when its own key doesn't already mix well with the outgoing track's *effective*
 * key (chooseKeyShift in transitionPlan.ts), so the key journey moves around the Camelot wheel
 * instead of collapsing every track onto one pitch.
 */
export class AiDjEngineController {
  private sessionId: string | null = null;
  private order: PlaylistTrackItem[] = [];
  private targetBpm = 120;
  private prepEntries = new Map<number, PrepEntry>();
  private beatGridCache = new Map<number, { bpm: number; downbeats: number[] }>();
  private currentRuntime: CurrentRuntime | null = null;

  async beginSession(playlistId: number, order: PlaylistTrackItem[], skippedCount: number, targetBpm: number): Promise<void> {
    this.endSession();
    const store = useAiDjStore.getState();
    store.startSession(playlistId, order, skippedCount, targetBpm);
    this.sessionId = useAiDjStore.getState().sessionId;
    this.order = order;
    this.targetBpm = targetBpm;

    usePlayerStore.getState().setPlaying(false);
    useMixtapePlayerStore.getState().setMixtapePlaying(false);
    useDjStore.getState().setDjPlaying(false);
    useTransportSourceStore.getState().setActiveSource("aidj");

    fetchAiDjDeviceInfo()
      .then((info) => store.setDeviceInfo({ available: info.available, device: info.device, cudaDeviceName: info.cuda_device_name }))
      .catch(() => store.setDeviceInfo(null));

    await this.playColdFromIndex(0);
  }

  pause(): void {
    pauseAiDjPlayback();
  }

  resume(): void {
    resumeAiDjPlayback();
  }

  togglePlayPause(): void {
    if (!this.currentRuntime) return;
    if (useAiDjStore.getState().isPlaying) this.pause();
    else this.resume();
  }

  skipNext(): void {
    const runtime = this.currentRuntime;
    if (!runtime) return;
    for (const t of runtime.timers) window.clearTimeout(t);
    getPlaybackEqualizer().disconnectAllAiDjStems();
    this.currentRuntime = null;
    useAiDjStore.getState().setTransition(null);
    void this.playColdFromIndex(runtime.index + 1);
  }

  endSession(): void {
    if (this.currentRuntime) {
      for (const t of this.currentRuntime.timers) window.clearTimeout(t);
    }
    getPlaybackEqualizer().disconnectAllAiDjStems();
    for (const entry of this.prepEntries.values()) {
      if (entry.jobId && entry.status !== "ready" && entry.status !== "failed") {
        void cancelAiDjStemsJob(entry.jobId).catch(() => {});
      }
    }
    this.currentRuntime = null;
    this.prepEntries.clear();
    this.beatGridCache.clear();
    this.sessionId = null;
    useAiDjStore.getState().stopSession();
  }

  // -- track startup --------------------------------------------------------

  private prepFor(trackId: number): PrepEntry {
    let entry = this.prepEntries.get(trackId);
    if (!entry) {
      entry = emptyPrepEntry();
      this.prepEntries.set(trackId, entry);
    }
    return entry;
  }

  private stemHandlesFor(trackId: number): StemHandles {
    return { vocals: `${trackId}:vocals`, instrumental: `${trackId}:instrumental` };
  }

  private fullHandleFor(trackId: number): string {
    return `${trackId}:full`;
  }

  /** targetBpm/track's-own-bpm — the permanent time-stretch ratio every AI DJ track plays at, from
   *  the moment it starts through to when it's eventually the outgoing side of a later transition. */
  private tempoRatioFor(track: PlaylistTrackItem): number {
    return track.bpm ? this.targetBpm / track.bpm : 1;
  }

  private async getBeatGrid(track: PlaylistTrackItem): Promise<{ bpm: number; downbeats: number[] }> {
    const cached = this.beatGridCache.get(track.id);
    if (cached) return cached;
    try {
      const grid = await fetchBeatGrid(track.id);
      const result = { bpm: grid.bpm, downbeats: grid.downbeats };
      this.beatGridCache.set(track.id, result);
      return result;
    } catch {
      const fallback = { bpm: track.bpm ?? 120, downbeats: [] as number[] };
      this.beatGridCache.set(track.id, fallback);
      return fallback;
    }
  }

  private async ensureFallbackBuffer(track: PlaylistTrackItem): Promise<AudioBuffer> {
    const entry = this.prepFor(track.id);
    if (entry.fullBuffer) return entry.fullBuffer;
    const buffer = await decodeStemBuffer(streamUrl(track.id));
    entry.fullBuffer = buffer;
    return buffer;
  }

  /** Looks for a safe (post-halfway, near-identically-repeating) loop point in `track`'s own
   *  audio, using its already-separated stems summed back into an approximate full mix — a chorus
   *  won't false-positive this way, since its vocals vary even though the instrumental repeats.
   *  Returns null (falling back to computeTransitionPlan's default end-of-track point) whenever
   *  those stems aren't ready yet; see the module doc comment on prepStems for why that's usually
   *  fine in practice. */
  private findSafeLoopSection(track: PlaylistTrackItem, info: TransitionTrackInfo): LoopSection | null {
    const entry = this.prepFor(track.id);
    if (!entry.vocalsBuffer || !entry.instrumentalBuffer) return null;
    const ctx = getPlaybackEqualizer().ensureAudioContext();
    if (!ctx) return null;
    try {
      const mix = sumAudioBuffers(entry.vocalsBuffer, entry.instrumentalBuffer, ctx);
      return findLoopSection(mix, info.bpm, info.downbeats, info.durationSeconds);
    } catch {
      return null;
    }
  }

  /** JIT background pipeline: separates one track's stems and decodes both buffers, updating the
   *  store's prep-status badge as it goes. Safe to call more than once for the same track — a
   *  second call is a no-op once the first has moved past "idle". */
  private async prepStems(track: PlaylistTrackItem): Promise<void> {
    const entry = this.prepFor(track.id);
    if (entry.status !== "idle") return;
    entry.status = "queued";
    useAiDjStore.getState().setPrepStatus(track.id, "queued");

    void this.getBeatGrid(track);

    try {
      const sessionId = this.sessionId;
      if (!sessionId) throw new Error("No active AI DJ session.");
      const job = await postAiDjStemsJob(track.id, sessionId);
      entry.jobId = job.id;
      entry.status = "separating";
      useAiDjStore.getState().setPrepStatus(track.id, "separating");

      const final = await watchAiDjStemsJob(job.id);
      if (!final || final.status !== "completed") {
        throw new Error(final?.error ?? "Stem separation did not complete.");
      }

      const [vocals, instrumental] = await Promise.all([
        decodeStemBuffer(aiDjStemAudioUrl(job.id, "vocals")),
        decodeStemBuffer(aiDjStemAudioUrl(job.id, "instrumental")),
      ]);
      entry.vocalsBuffer = vocals;
      entry.instrumentalBuffer = instrumental;
      entry.status = "ready";
      useAiDjStore.getState().setPrepStatus(track.id, "ready");
    } catch {
      entry.status = "failed";
      useAiDjStore.getState().setPrepStatus(track.id, "failed");
    }
  }

  private publishRuntimeAnchor(runtime: CurrentRuntime): void {
    useAiDjStore.getState().setRuntimeAnchor({
      anchorContextTime: runtime.anchorContextTime,
      anchorPosition: runtime.anchorPosition,
      tempoRatio: runtime.tempoRatio,
    });
  }

  /** Starts `order[index]` with no crossfade — used for the session's very first track and after
   *  a manual skip. Prefers already-separated stems (e.g. this track finished prepping as
   *  "next" before the skip landed on it) over a fresh whole-mix fetch. The first track (and any
   *  track landed on via skip) starts at its own native key — there's no predecessor to match. */
  private async playColdFromIndex(index: number): Promise<void> {
    const track = this.order[index];
    const store = useAiDjStore.getState();
    if (!track) {
      this.endSession();
      return;
    }

    store.advanceToIndex(index);
    store.setLoading(true);
    store.setError(null);

    const eq = getPlaybackEqualizer();
    const ctx = eq.ensureAudioContext();
    if (!ctx) {
      store.setError("Web Audio is not available in this browser.");
      store.setLoading(false);
      return;
    }
    await eq.resume();

    const entry = this.prepFor(track.id);
    const startAt = ctx.currentTime + START_PAD_SEC;
    const tempoRatio = this.tempoRatioFor(track);
    let runtime: CurrentRuntime;

    try {
      if (entry.status === "ready" && entry.vocalsBuffer && entry.instrumentalBuffer) {
        const handles = this.stemHandlesFor(track.id);
        await eq.startAiDjStem(handles.vocals, entry.vocalsBuffer, { when: startAt, gain: 1, tempoRatio });
        await eq.startAiDjStem(handles.instrumental, entry.instrumentalBuffer, { when: startAt, gain: 1, tempoRatio });
        runtime = { track, index, handles, anchorPosition: 0, anchorContextTime: startAt, tempoRatio, pitchSemitones: 0, timers: [] };
      } else {
        const full = await this.ensureFallbackBuffer(track);
        const handle = this.fullHandleFor(track.id);
        await eq.startAiDjStem(handle, full, { when: startAt, gain: 1, tempoRatio });
        runtime = { track, index, handles: { full: handle }, anchorPosition: 0, anchorContextTime: startAt, tempoRatio, pitchSemitones: 0, timers: [] };
      }
    } catch (err) {
      store.setError(err instanceof Error ? err.message : "Could not start playback.");
      store.setLoading(false);
      return;
    }

    this.currentRuntime = runtime;
    store.setLoading(false);
    store.setPlaying(true);
    store.setTransition(null);
    this.publishRuntimeAnchor(runtime);

    if (isFullHandle(runtime.handles)) void this.prepStems(track);
    const next = this.order[index + 1];
    if (next) void this.prepStems(next);

    void this.planOwnTransition(runtime);
  }

  // -- transition planning & scheduling --------------------------------------

  private async planOwnTransition(runtime: CurrentRuntime): Promise<void> {
    const next = this.order[runtime.index + 1];
    if (!next) return; // last track in the crate — let it play out, no more transitions

    const [selfGrid, nextGrid] = await Promise.all([this.getBeatGrid(runtime.track), this.getBeatGrid(next)]);
    if (this.currentRuntime !== runtime) return; // superseded by a skip/stop while we awaited

    const outgoingInfo: TransitionTrackInfo = {
      bpm: selfGrid.bpm,
      key: runtime.track.key,
      durationSeconds: runtime.track.durationSeconds,
      downbeats: selfGrid.downbeats,
    };
    const incomingInfo: TransitionTrackInfo = {
      bpm: nextGrid.bpm,
      key: next.key,
      durationSeconds: next.durationSeconds,
      downbeats: nextGrid.downbeats,
    };
    const outgoingEffectiveKey = runtime.track.key ? (transposeCamelotKey(runtime.track.key, runtime.pitchSemitones) ?? runtime.track.key) : null;
    const loopSection = this.findSafeLoopSection(runtime.track, outgoingInfo);
    const plan = computeTransitionPlan(outgoingInfo, incomingInfo, this.targetBpm, outgoingEffectiveKey, loopSection);

    const ctx = getPlaybackEqualizer().ensureAudioContext();
    if (!ctx) return;
    const triggerContextTime = runtime.anchorContextTime + (plan.outgoingStartSec - runtime.anchorPosition) / runtime.tempoRatio;
    const now = ctx.currentTime;

    const deadlineDelayMs = Math.max(0, (triggerContextTime - DEADLINE_LEAD_SEC - now) * 1000);
    const triggerDelayMs = Math.max(0, (triggerContextTime - now) * 1000);

    const deadlineTimer = window.setTimeout(() => this.checkPrepDeadline(next), deadlineDelayMs);
    const triggerTimer = window.setTimeout(() => void this.performTransition(runtime, next, plan, triggerContextTime), triggerDelayMs);
    runtime.timers.push(deadlineTimer, triggerTimer);

    if (plan.loopRegion) {
      // Whatever's currently playing for this track (full mix or its own stems) should hold on
      // the verified-safe loop once it gets there, in case it reaches that point before the
      // trigger fires and swaps in fresh (already-looping) sources of its own.
      const eq = getPlaybackEqualizer();
      const handles = runtime.handles;
      if (isFullHandle(handles)) {
        eq.setAiDjStemLoop(handles.full, plan.loopRegion.startSec, plan.loopRegion.endSec);
      } else {
        eq.setAiDjStemLoop(handles.vocals, plan.loopRegion.startSec, plan.loopRegion.endSec);
        eq.setAiDjStemLoop(handles.instrumental, plan.loopRegion.startSec, plan.loopRegion.endSec);
      }
    }
  }

  private checkPrepDeadline(next: PlaylistTrackItem): void {
    const entry = this.prepFor(next.id);
    if (entry.vocalsBuffer && entry.instrumentalBuffer) return; // made it in time
    useAiDjStore.getState().setPrepStatus(next.id, "fallback");
    void this.ensureFallbackBuffer(next).catch(() => {});
  }

  private async performTransition(runtime: CurrentRuntime, next: PlaylistTrackItem, plan: TransitionPlan, triggerContextTime: number): Promise<void> {
    if (this.currentRuntime !== runtime) return;
    const eq = getPlaybackEqualizer();
    const ctx = eq.ensureAudioContext();
    if (!ctx) return;

    const entry = this.prepFor(next.id);
    const nextIndex = runtime.index + 1;

    if (entry.vocalsBuffer && entry.instrumentalBuffer) {
      await this.performMashupTransition(runtime, next, nextIndex, plan, triggerContextTime, entry.vocalsBuffer, entry.instrumentalBuffer);
      return;
    }

    const full = entry.fullBuffer ?? (await this.ensureFallbackBuffer(next).catch(() => null));
    if (this.currentRuntime !== runtime) return;
    if (!full) {
      useAiDjStore.getState().setError(`Skipped "${next.title ?? "a track"}" — its audio couldn't be loaded.`);
      void this.playColdFromIndex(nextIndex + 1);
      return;
    }
    const at = Math.max(ctx.currentTime + START_PAD_SEC, triggerContextTime);
    this.performFallbackTransition(runtime, next, nextIndex, full, at, plan);
  }

  private async performMashupTransition(
    runtime: CurrentRuntime,
    next: PlaylistTrackItem,
    nextIndex: number,
    plan: TransitionPlan,
    triggerContextTime: number,
    vocalsBuffer: AudioBuffer,
    instrumentalBuffer: AudioBuffer
  ): Promise<void> {
    const eq = getPlaybackEqualizer();
    const nextHandles = this.stemHandlesFor(next.id);
    const incomingStartAt = triggerContextTime - plan.incomingLeadInSec;

    await eq.startAiDjStem(nextHandles.vocals, vocalsBuffer, {
      when: incomingStartAt,
      tempoRatio: plan.incomingTempoRatio,
      pitchSemitones: plan.incomingPitchSemitones,
      gain: 0,
    });
    await eq.startAiDjStem(nextHandles.instrumental, instrumentalBuffer, {
      when: incomingStartAt,
      tempoRatio: plan.incomingTempoRatio,
      pitchSemitones: plan.incomingPitchSemitones,
      gain: 0,
    });

    const vocalsFadeStart = triggerContextTime + plan.vocalsFade.offsetSec;
    const instrumentalFadeStart = triggerContextTime + plan.instrumentalFade.offsetSec;
    const transitionEnd = triggerContextTime + plan.totalDurationSec;

    const outHandles = runtime.handles;
    if (isFullHandle(outHandles)) {
      const selfEntry = this.prepFor(runtime.track.id);
      if (selfEntry.vocalsBuffer && selfEntry.instrumentalBuffer) {
        // Swap the full-mix buffer for this track's own stems at the exact trigger instant, same
        // offset — inaudible, since vocals+instrumental sum back to the same mix — so the
        // outgoing side of the mashup has independently-fadeable vocals/instrumental too. These
        // are fresh source nodes, so they need their own tempoRatio/loop settings even though the
        // full-mix source they replace already had them.
        const selfHandles = this.stemHandlesFor(runtime.track.id);
        await eq.startAiDjStem(selfHandles.vocals, selfEntry.vocalsBuffer, {
          when: triggerContextTime,
          offsetSec: plan.outgoingStartSec,
          gain: 1,
          tempoRatio: runtime.tempoRatio,
        });
        await eq.startAiDjStem(selfHandles.instrumental, selfEntry.instrumentalBuffer, {
          when: triggerContextTime,
          offsetSec: plan.outgoingStartSec,
          gain: 1,
          tempoRatio: runtime.tempoRatio,
        });
        if (plan.loopRegion) {
          eq.setAiDjStemLoop(selfHandles.vocals, plan.loopRegion.startSec, plan.loopRegion.endSec);
          eq.setAiDjStemLoop(selfHandles.instrumental, plan.loopRegion.startSec, plan.loopRegion.endSec);
        }
        eq.stopAiDjStem(outHandles.full, triggerContextTime);
        eq.scheduleAiDjStemGain(selfHandles.vocals, equalPowerOutCurve(1), vocalsFadeStart, plan.vocalsFade.durationSec);
        eq.scheduleAiDjStemGain(selfHandles.instrumental, equalPowerOutCurve(1), instrumentalFadeStart, plan.instrumentalFade.durationSec);
        eq.stopAiDjStem(selfHandles.vocals, transitionEnd);
        eq.stopAiDjStem(selfHandles.instrumental, transitionEnd);
      } else {
        // This track's own stems never finished separating either — plain crossfade out of
        // whatever it's already playing (still lands on the same bar-aligned trigger point).
        eq.scheduleAiDjStemGain(outHandles.full, equalPowerOutCurve(1), triggerContextTime, plan.totalDurationSec);
        eq.stopAiDjStem(outHandles.full, transitionEnd);
      }
    } else {
      eq.scheduleAiDjStemGain(outHandles.vocals, equalPowerOutCurve(1), vocalsFadeStart, plan.vocalsFade.durationSec);
      eq.scheduleAiDjStemGain(outHandles.instrumental, equalPowerOutCurve(1), instrumentalFadeStart, plan.instrumentalFade.durationSec);
      eq.stopAiDjStem(outHandles.vocals, transitionEnd);
      eq.stopAiDjStem(outHandles.instrumental, transitionEnd);
    }

    eq.scheduleAiDjStemGain(nextHandles.vocals, equalPowerInCurve(1), vocalsFadeStart, plan.vocalsFade.durationSec);
    eq.scheduleAiDjStemGain(nextHandles.instrumental, equalPowerInCurve(1), instrumentalFadeStart, plan.instrumentalFade.durationSec);
    // No tempo/pitch ramp-back: incoming is already at its permanent session values
    // (plan.incomingTempoRatio / plan.incomingPitchSemitones) and simply keeps playing at them.

    const logicalPositionAtSettle = plan.incomingTempoRatio * (transitionEnd - incomingStartAt);

    this.commitTransition(
      runtime,
      next,
      nextIndex,
      nextHandles,
      logicalPositionAtSettle,
      transitionEnd,
      triggerContextTime,
      plan.totalDurationSec,
      "mashup",
      plan.incomingTempoRatio,
      plan.incomingPitchSemitones
    );
  }

  private performFallbackTransition(
    runtime: CurrentRuntime,
    next: PlaylistTrackItem,
    nextIndex: number,
    fullBuffer: AudioBuffer,
    triggerContextTime: number,
    plan: TransitionPlan
  ): void {
    const eq = getPlaybackEqualizer();
    const nextHandle = this.fullHandleFor(next.id);
    const tempoRatio = this.tempoRatioFor(next);
    void eq.startAiDjStem(nextHandle, fullBuffer, { when: triggerContextTime, gain: 0, tempoRatio, pitchSemitones: plan.incomingPitchSemitones });
    eq.scheduleAiDjStemGain(nextHandle, equalPowerInCurve(1), triggerContextTime, FALLBACK_CROSSFADE_SEC);

    const outHandles = runtime.handles;
    if (isFullHandle(outHandles)) {
      eq.scheduleAiDjStemGain(outHandles.full, equalPowerOutCurve(1), triggerContextTime, FALLBACK_CROSSFADE_SEC);
      eq.stopAiDjStem(outHandles.full, triggerContextTime + FALLBACK_CROSSFADE_SEC);
    } else {
      eq.scheduleAiDjStemGain(outHandles.vocals, equalPowerOutCurve(1), triggerContextTime, FALLBACK_CROSSFADE_SEC);
      eq.scheduleAiDjStemGain(outHandles.instrumental, equalPowerOutCurve(1), triggerContextTime, FALLBACK_CROSSFADE_SEC);
      eq.stopAiDjStem(outHandles.vocals, triggerContextTime + FALLBACK_CROSSFADE_SEC);
      eq.stopAiDjStem(outHandles.instrumental, triggerContextTime + FALLBACK_CROSSFADE_SEC);
    }

    this.commitTransition(
      runtime,
      next,
      nextIndex,
      { full: nextHandle },
      0,
      triggerContextTime,
      triggerContextTime,
      FALLBACK_CROSSFADE_SEC,
      "fallback",
      tempoRatio,
      plan.incomingPitchSemitones
    );
  }

  private commitTransition(
    oldRuntime: CurrentRuntime,
    track: PlaylistTrackItem,
    index: number,
    handles: StemHandles | FullHandle,
    anchorPosition: number,
    anchorContextTime: number,
    transitionStart: number,
    transitionDuration: number,
    kind: "mashup" | "fallback",
    tempoRatio: number,
    pitchSemitones: number
  ): void {
    for (const t of oldRuntime.timers) window.clearTimeout(t);

    const runtime: CurrentRuntime = { track, index, handles, anchorPosition, anchorContextTime, tempoRatio, pitchSemitones, timers: [] };
    this.currentRuntime = runtime;

    const store = useAiDjStore.getState();
    store.advanceToIndex(index);
    store.setTransition({ startContextTime: transitionStart, totalDurationSec: transitionDuration, fromTrackId: oldRuntime.track.id, toTrackId: track.id, kind });
    this.publishRuntimeAnchor(runtime);

    const ctx = getPlaybackEqualizer().ensureAudioContext();
    const clearDelayMs = Math.max(0, (transitionStart + transitionDuration - (ctx?.currentTime ?? transitionStart)) * 1000);
    const clearTimer = window.setTimeout(() => {
      if (useAiDjStore.getState().transition?.toTrackId === track.id) useAiDjStore.getState().setTransition(null);
    }, clearDelayMs);
    runtime.timers.push(clearTimer);

    if (isFullHandle(handles)) void this.prepStems(track);
    const nextNext = this.order[index + 1];
    if (nextNext) void this.prepStems(nextNext);

    void this.planOwnTransition(runtime);
  }
}

/**
 * Returns a stable AI DJ engine controller for the mounted AI DJ route. The controller owns all
 * imperative Web Audio scheduling; components read reactive session state from useAiDjStore
 * separately and call the controller's methods (beginSession/pause/resume/skipNext/endSession) in
 * response to user actions.
 */
export function useAiDjEngine() {
  const [controller] = useState(() => new AiDjEngineController());

  useEffect(() => {
    return () => controller.endSession();
  }, [controller]);

  return controller;
}

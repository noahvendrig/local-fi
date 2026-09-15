// Type-only import: SoundTouchNode's class body does `extends AudioWorkletNode` at module scope,
// which throws (AudioWorkletNode is undefined) if this module is ever evaluated server-side
// during SSR — as it always is, since this file is imported by the globally-mounted
// TransportBar. A real value import must stay dynamic (see connectDjSource below); this type
// import is erased at compile time, so it's safe.
import type { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import { equalPowerInCurve, equalPowerOutCurve } from "./crossfade";
import { EQ_BAND_HZ, EQ_Q, dbToLinear, type EqState } from "./eqConfig";

export type DeckId = 0 | 1;

/** Caller-chosen key identifying one live AI DJ stem source, e.g. `${trackId}:vocals`. */
export type AiDjStemHandle = string;

interface AiDjStemNode {
  source: AudioBufferSourceNode;
  st: SoundTouchNode;
  gain: GainNode;
}

const SOUNDTOUCH_PROCESSOR_URL = "/soundtouch-processor.js";

/**
 * Dual-deck Web Audio graph. Two <audio> elements mix through per-deck fade gains
 * (loudness match + crossfade), then the shared EQ / analyser / volume chain.
 * createMediaElementSource can only run once per element, so this stays a module
 * singleton and is never closed for the lifetime of the page.
 *
 * Graph: sourceA/B → fadeA/B → mixer → EQ filters → preamp → analyser → volume → destination
 */
class PlaybackEqualizer {
  readonly debugId = Math.random().toString(36).slice(2, 8);
  private audioContext: AudioContext | null = null;
  private sourceNodes: [MediaElementAudioSourceNode | null, MediaElementAudioSourceNode | null] = [null, null];
  private fadeNodes: [GainNode | null, GainNode | null] = [null, null];
  private mixerNode: GainNode | null = null;
  private filterNodes: BiquadFilterNode[] = [];
  private preampNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private volumeNode: GainNode | null = null;
  private connectedElements: [HTMLAudioElement | null, HTMLAudioElement | null] = [null, null];
  private pending: { eq: Pick<EqState, "enabled" | "gains" | "preamp">; volume: number } = {
    eq: { enabled: true, gains: EQ_BAND_HZ.map(() => 0), preamp: 0 },
    volume: 1,
  };
  private pendingDeckGain: [number, number] = [1, 0];

  // DJ view (§Phase 4) — a parallel source feeding the same mixer/EQ/volume chain as the
  // regular decks, so DJ-mode playback gets identical EQ/volume behavior for free. Kept
  // entirely separate from connectDeck/crossfadeDecks so normal playback is never touched.
  private djSourceNode: MediaElementAudioSourceNode | null = null;
  private djStNode: SoundTouchNode | null = null;
  private djGainNode: GainNode | null = null;
  private djConnectedElement: HTMLAudioElement | null = null;
  private djProcessorRegistered: Promise<void> | null = null;
  // createMediaElementSource may only ever be called once per element for its entire lifetime
  // (Web Audio API constraint) — reconnecting the DJ chain must reuse a cached source rather than
  // recreate one, or React Strict Mode's dev-only double effect invoke (mount/cleanup/mount on
  // the same element) throws InvalidStateError on the second connect.
  private djSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

  // AI DJ (§Phase 6) — a separate, isolated chain from the single-source DJ chain above, since a
  // live AI DJ transition needs up to 4 simultaneous stem sources at once (outgoing vocals/
  // instrumental fading out, incoming vocals/instrumental fading in). Each stem is keyed by a
  // caller-chosen handle rather than a fixed slot, so useAiDjEngine.ts can track "current" and
  // "next" independently of a hardcoded deck count. Feeds the same shared mixer as everything
  // else, so EQ/volume apply uniformly.
  private aiDjStems = new Map<AiDjStemHandle, AiDjStemNode>();
  private aiDjProcessorRegistered: Promise<void> | null = null;

  connectDeck(audio: HTMLAudioElement, deck: DeckId): void {
    if (this.sourceNodes[deck] && this.connectedElements[deck] === audio) return;
    if (this.sourceNodes[deck]) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.mixerNode) return;

    const source = ctx.createMediaElementSource(audio);
    const fade = ctx.createGain();
    fade.gain.value = this.pendingDeckGain[deck];
    source.connect(fade);
    fade.connect(this.mixerNode);

    this.sourceNodes[deck] = source;
    this.fadeNodes[deck] = fade;
    this.connectedElements[deck] = audio;
    audio.volume = 1;
    this.applyPending();
  }

  async resume(): Promise<void> {
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  setEq(eq: Pick<EqState, "enabled" | "gains" | "preamp">): void {
    this.pending.eq = eq;
    this.applyPending();
  }

  setVolume(volume: number): void {
    this.pending.volume = Math.min(1, Math.max(0, volume));
    this.applyPending();
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  setDeckGain(deck: DeckId, linear: number): void {
    const gain = Math.max(0, linear);
    this.pendingDeckGain[deck] = gain;
    const node = this.fadeNodes[deck];
    const ctx = this.audioContext;
    if (!node || !ctx) return;
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(gain, now);
  }

  crossfadeDecks(outDeck: DeckId, inDeck: DeckId, outLoudness: number, inLoudness: number, durationSec: number): void {
    const outNode = this.fadeNodes[outDeck];
    const inNode = this.fadeNodes[inDeck];
    const ctx = this.audioContext;
    if (!outNode || !inNode || !ctx) {
      this.pendingDeckGain[outDeck] = 0;
      this.pendingDeckGain[inDeck] = inLoudness;
      return;
    }

    const duration = Math.max(0.05, durationSec);
    const now = ctx.currentTime;
    outNode.gain.cancelScheduledValues(now);
    inNode.gain.cancelScheduledValues(now);
    outNode.gain.setValueCurveAtTime(equalPowerOutCurve(outLoudness), now, duration);
    inNode.gain.setValueCurveAtTime(equalPowerInCurve(inLoudness), now, duration);

    this.pendingDeckGain[outDeck] = 0;
    this.pendingDeckGain[inDeck] = inLoudness;
  }

  /** Connects a dedicated DJ-mode `<audio>` element through a SoundTouch time-stretch node into the shared mixer. Safe to call again with a new element (e.g. DJ view remount) — the previous DJ chain is torn down first. Also safe to call again with the *same* element (React Strict Mode's double effect invoke) — reuses that element's cached source node instead of trying to create a second one. */
  async connectDjSource(audio: HTMLAudioElement): Promise<void> {
    if (this.djConnectedElement === audio && this.djSourceNode) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.mixerNode) return;

    // Dynamic import: SoundTouchNode extends AudioWorkletNode at module scope, which throws if
    // evaluated outside a browser (see the type-only import note above). Deferring the real
    // import to here — only ever called client-side, from a useEffect — keeps this file SSR-safe.
    const { SoundTouchNode: SoundTouchNodeCtor } = await import("@soundtouchjs/audio-worklet");

    if (!this.djProcessorRegistered) {
      this.djProcessorRegistered = SoundTouchNodeCtor.register(ctx, SOUNDTOUCH_PROCESSOR_URL);
    }
    await this.djProcessorRegistered;

    this.djStNode?.disconnect();
    this.djGainNode?.disconnect();
    this.djSourceNode?.disconnect();

    let source = this.djSourceCache.get(audio) ?? null;
    if (!source) {
      source = ctx.createMediaElementSource(audio);
      this.djSourceCache.set(audio, source);
    }
    const stNode = new SoundTouchNodeCtor({ context: ctx });
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(stNode);
    stNode.connect(gain);
    gain.connect(this.mixerNode);

    this.djSourceNode = source;
    this.djStNode = stNode;
    this.djGainNode = gain;
    this.djConnectedElement = audio;
    audio.volume = 1;
  }

  disconnectDjSource(): void {
    this.djSourceNode?.disconnect();
    this.djStNode?.disconnect();
    this.djGainNode?.disconnect();
    this.djSourceNode = null;
    this.djStNode = null;
    this.djGainNode = null;
    this.djConnectedElement = null;
  }

  /**
   * Applies a live tempo/pitch adjustment to the DJ source. `tempoRatio` must also be set on the
   * `<audio>` element's own `playbackRate` by the caller — SoundTouch mirrors it to compensate
   * pitch (see @soundtouchjs/audio-worklet's docs: this is what keeps pitch fixed while tempo
   * moves). `pitchSemitones` is an additional independent shift on top, used to land on a target
   * key; it's a no-op (0) when key lock is off, so pitch is left to follow tempo naturally.
   */
  setDjTempoPitch(tempoRatio: number, pitchSemitones: number): void {
    const ctx = this.audioContext;
    const stNode = this.djStNode;
    if (!ctx || !stNode) return;
    stNode.playbackRate.setValueAtTime(tempoRatio, ctx.currentTime);
    stNode.pitchSemitones.setValueAtTime(pitchSemitones, ctx.currentTime);
  }

  /** The shared AudioContext's current time, or null before it's been created. Lets callers (e.g.
   *  useAiDjEngine) schedule AI DJ stem starts/fades against the same clock this class uses. */
  getAudioContextTime(): number | null {
    return this.audioContext?.currentTime ?? null;
  }

  /** Ensures the shared AudioContext exists and decodes audio the same way DJ-mode stems will
   *  play back through — used by decodeStemBuffer.ts so a fetched stem WAV is decoded against
   *  the exact context it will later be scheduled on. */
  ensureAudioContext(): AudioContext | null {
    return this.ensureContext();
  }

  private async ensureAiDjWorklet(): Promise<{ ctx: AudioContext; SoundTouchNodeCtor: typeof SoundTouchNode } | null> {
    const ctx = this.ensureContext();
    if (!ctx || !this.mixerNode) return null;
    const { SoundTouchNode: SoundTouchNodeCtor } = await import("@soundtouchjs/audio-worklet");
    if (!this.aiDjProcessorRegistered) {
      this.aiDjProcessorRegistered = SoundTouchNodeCtor.register(ctx, SOUNDTOUCH_PROCESSOR_URL);
    }
    await this.aiDjProcessorRegistered;
    return { ctx, SoundTouchNodeCtor };
  }

  /**
   * Starts one AI DJ stem buffer (a decoded vocals/instrumental/full-mix AudioBuffer) through its
   * own SoundTouch time-stretch node into the shared mixer, keyed by `handle`. Each call creates a
   * fresh AudioBufferSourceNode — per the Web Audio spec a source can only ever be started once —
   * so call this again with the same handle only after that handle's previous node has
   * ended/stopped (disconnectAiDjStem clears it immediately if you need to replace it early).
   * `when` and the returned schedule are in the shared AudioContext's clock (getAudioContextTime).
   */
  async startAiDjStem(
    handle: AiDjStemHandle,
    buffer: AudioBuffer,
    opts: { when: number; offsetSec?: number; tempoRatio?: number; pitchSemitones?: number; gain?: number }
  ): Promise<void> {
    const ready = await this.ensureAiDjWorklet();
    if (!ready || !this.mixerNode) return;
    const { ctx, SoundTouchNodeCtor } = ready;

    this.disconnectAiDjStem(handle);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const st = new SoundTouchNodeCtor({ context: ctx });
    st.playbackRate.setValueAtTime(opts.tempoRatio ?? 1, ctx.currentTime);
    st.pitchSemitones.setValueAtTime(opts.pitchSemitones ?? 0, ctx.currentTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain ?? 1, ctx.currentTime);

    source.connect(st);
    st.connect(gain);
    gain.connect(this.mixerNode);

    const node: AiDjStemNode = { source, st, gain };
    source.onended = () => {
      if (this.aiDjStems.get(handle) !== node) return; // handle was already replaced/cleared
      st.disconnect();
      gain.disconnect();
      source.disconnect();
      this.aiDjStems.delete(handle);
    };

    source.start(Math.max(ctx.currentTime, opts.when), Math.max(0, opts.offsetSec ?? 0));
    this.aiDjStems.set(handle, node);
  }

  /** Immediately (no ramp) sets a stem's live tempo ratio / pitch shift. */
  setAiDjStemTempoPitch(handle: AiDjStemHandle, tempoRatio: number, pitchSemitones: number): void {
    const node = this.aiDjStems.get(handle);
    const ctx = this.audioContext;
    if (!node || !ctx) return;
    node.st.playbackRate.setValueAtTime(tempoRatio, ctx.currentTime);
    node.st.pitchSemitones.setValueAtTime(pitchSemitones, ctx.currentTime);
  }

  /** Sets a stem's underlying buffer source to natively loop [loopStartSec, loopEndSec) once
   *  playback reaches that region — used to hold an outgoing AI DJ track on a verified-safe,
   *  repeating phrase (see lib/audio/loopPointDetect.ts) for as long as a transition needs,
   *  instead of letting it play forward into unrepeated material. Safe to call before playback
   *  reaches loopStart; the source plays through normally up to loopEnd once, then wraps. */
  setAiDjStemLoop(handle: AiDjStemHandle, loopStartSec: number, loopEndSec: number): void {
    const node = this.aiDjStems.get(handle);
    if (!node) return;
    node.source.loop = true;
    node.source.loopStart = loopStartSec;
    node.source.loopEnd = loopEndSec;
  }

  /** Immediately (no ramp) sets a stem's gain — e.g. to hard-mute one that's already faded out. */
  setAiDjStemGain(handle: AiDjStemHandle, gain: number): void {
    const node = this.aiDjStems.get(handle);
    const ctx = this.audioContext;
    if (!node || !ctx) return;
    node.gain.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.gain.setValueAtTime(gain, ctx.currentTime);
  }

  /** Schedules an equal-power gain ramp (see crossfade.ts's curves) on a stem, starting at AudioContext time `when`. */
  scheduleAiDjStemGain(handle: AiDjStemHandle, curve: Float32Array, when: number, durationSec: number): void {
    const node = this.aiDjStems.get(handle);
    if (!node) return;
    node.gain.gain.cancelScheduledValues(when);
    node.gain.gain.setValueCurveAtTime(curve, when, Math.max(0.05, durationSec));
  }

  /** Stops an AI DJ stem's source at AudioContext time `when` (default: immediately). Its onended handler tears down the rest of the chain. */
  stopAiDjStem(handle: AiDjStemHandle, when?: number): void {
    const node = this.aiDjStems.get(handle);
    if (!node) return;
    try {
      node.source.stop(when);
    } catch {
      // Already stopped/ended — nothing to do.
    }
  }

  /** Immediately tears down and forgets an AI DJ stem, whether or not it was still playing. */
  disconnectAiDjStem(handle: AiDjStemHandle): void {
    const node = this.aiDjStems.get(handle);
    if (!node) return;
    node.source.onended = null;
    try {
      node.source.stop();
    } catch {
      // Already stopped/ended.
    }
    node.source.disconnect();
    node.st.disconnect();
    node.gain.disconnect();
    this.aiDjStems.delete(handle);
  }

  /** Tears down every live AI DJ stem — called when a session ends or the route unmounts. */
  disconnectAllAiDjStems(): void {
    for (const handle of Array.from(this.aiDjStems.keys())) this.disconnectAiDjStem(handle);
  }

  private ensureContext(): AudioContext | null {
    if (this.audioContext) return this.audioContext;

    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor();
    const mixer = ctx.createGain();
    mixer.gain.value = 1;
    const filters = EQ_BAND_HZ.map((hz) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = hz;
      filter.Q.value = EQ_Q;
      filter.gain.value = 0;
      return filter;
    });
    const preamp = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    const volume = ctx.createGain();

    let previous: AudioNode = mixer;
    for (const filter of filters) {
      previous.connect(filter);
      previous = filter;
    }
    previous.connect(preamp);
    preamp.connect(analyser);
    analyser.connect(volume);
    volume.connect(ctx.destination);

    this.audioContext = ctx;
    this.mixerNode = mixer;
    this.filterNodes = filters;
    this.preampNode = preamp;
    this.analyserNode = analyser;
    this.volumeNode = volume;
    return ctx;
  }

  private applyPending(): void {
    if (!this.preampNode || !this.volumeNode || this.filterNodes.length === 0) return;
    const { enabled, gains, preamp } = this.pending.eq;
    for (let i = 0; i < this.filterNodes.length; i++) {
      this.filterNodes[i].gain.value = enabled ? (gains[i] ?? 0) : 0;
    }
    this.preampNode.gain.value = enabled ? dbToLinear(preamp) : 1;
    this.volumeNode.gain.value = this.pending.volume;
  }

  /** Dev-only introspection for debugging the audio graph from the console. */
  debugSnapshot() {
    return {
      audioContextState: this.audioContext?.state ?? null,
      mixerGain: this.mixerNode?.gain.value ?? null,
      preampGain: this.preampNode?.gain.value ?? null,
      volumeGain: this.volumeNode?.gain.value ?? null,
      pendingVolume: this.pending.volume,
      deckGains: this.pendingDeckGain,
      djGain: this.djGainNode?.gain.value ?? null,
      djStPlaybackRate: this.djStNode?.playbackRate.value ?? null,
      djStPitch: this.djStNode?.pitch.value ?? null,
      djStPitchSemitones: this.djStNode?.pitchSemitones.value ?? null,
      djStMetrics: this.djStNode?.metrics ?? null,
      djConnected: this.djConnectedElement != null,
    };
  }
}

let instance: PlaybackEqualizer | null = null;

export function getPlaybackEqualizer(): PlaybackEqualizer {
  if (!instance) {
    instance = new PlaybackEqualizer();
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      (window as unknown as { __lfEqualizer: PlaybackEqualizer }).__lfEqualizer = instance;
    }
  }
  return instance;
}

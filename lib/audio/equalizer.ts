// Type-only import: SoundTouchNode's class body does `extends AudioWorkletNode` at module scope,
// which throws (AudioWorkletNode is undefined) if this module is ever evaluated server-side
// during SSR — as it always is, since this file is imported by the globally-mounted
// TransportBar. A real value import must stay dynamic (see connectDjSource below); this type
// import is erased at compile time, so it's safe.
import type { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import { equalPowerInCurve, equalPowerOutCurve } from "./crossfade";
import { EQ_BAND_HZ, EQ_Q, dbToLinear, type EqState } from "./eqConfig";

export type DeckId = 0 | 1;

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

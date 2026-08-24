import { EQ_BAND_HZ, EQ_Q, dbToLinear, type EqState } from "./eqConfig";

/**
 * One Web Audio graph for the app's single <audio> element.
 * createMediaElementSource can only be called once per element, so this stays
 * a module singleton and is never closed for the lifetime of the page.
 */
class PlaybackEqualizer {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private filterNodes: BiquadFilterNode[] = [];
  private preampNode: GainNode | null = null;
  private volumeNode: GainNode | null = null;
  private connectedElement: HTMLAudioElement | null = null;
  private pending: { eq: Pick<EqState, "enabled" | "gains" | "preamp">; volume: number } = {
    eq: { enabled: true, gains: EQ_BAND_HZ.map(() => 0), preamp: 0 },
    volume: 1,
  };

  connect(audio: HTMLAudioElement): void {
    if (this.sourceNode && this.connectedElement === audio) return;
    if (this.sourceNode) return;

    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const ctx = new AudioContextCtor();
    const source = ctx.createMediaElementSource(audio);
    const filters = EQ_BAND_HZ.map((hz) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = hz;
      filter.Q.value = EQ_Q;
      filter.gain.value = 0;
      return filter;
    });
    const preamp = ctx.createGain();
    const volume = ctx.createGain();

    let previous: AudioNode = source;
    for (const filter of filters) {
      previous.connect(filter);
      previous = filter;
    }
    previous.connect(preamp);
    preamp.connect(volume);
    volume.connect(ctx.destination);

    this.audioContext = ctx;
    this.sourceNode = source;
    this.filterNodes = filters;
    this.preampNode = preamp;
    this.volumeNode = volume;
    this.connectedElement = audio;
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

  private applyPending(): void {
    if (!this.preampNode || !this.volumeNode || this.filterNodes.length === 0) return;
    const { enabled, gains, preamp } = this.pending.eq;
    for (let i = 0; i < this.filterNodes.length; i++) {
      this.filterNodes[i].gain.value = enabled ? (gains[i] ?? 0) : 0;
    }
    this.preampNode.gain.value = enabled ? dbToLinear(preamp) : 1;
    this.volumeNode.gain.value = this.pending.volume;
  }
}

let instance: PlaybackEqualizer | null = null;

export function getPlaybackEqualizer(): PlaybackEqualizer {
  if (!instance) instance = new PlaybackEqualizer();
  return instance;
}

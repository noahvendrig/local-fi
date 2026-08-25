declare module "music-tempo" {
  export default class MusicTempo {
    constructor(audioData: Float32Array, params?: Record<string, number>);
    // Despite the docs calling this a number, the library actually returns it as a string
    // (verified empirically — Number.isFinite(result.tempo) is false without coercion).
    tempo: number | string;
    beats: number[];
  }
}

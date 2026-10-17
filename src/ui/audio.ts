export type SoundName = 'start' | 'eat' | 'pause' | 'resume' | 'over' | 'won';

/** Tiny WebAudio synth: every sound is a couple of oscillator blips, no assets. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Must be called from a user gesture before anything can play. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
  }

  play(name: SoundName): void {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'start':
        this.tone(440, t, 0.08, 'square');
        this.tone(660, t + 0.09, 0.12, 'square');
        break;
      case 'eat':
        this.tone(880, t, 0.05, 'square', 0.12);
        this.tone(1320, t + 0.05, 0.08, 'square', 0.12);
        break;
      case 'pause':
        this.tone(520, t, 0.06, 'triangle');
        this.tone(390, t + 0.07, 0.08, 'triangle');
        break;
      case 'resume':
        this.tone(390, t, 0.06, 'triangle');
        this.tone(520, t + 0.07, 0.08, 'triangle');
        break;
      case 'over':
        this.tone(330, t, 0.12, 'sawtooth', 0.1);
        this.tone(240, t + 0.13, 0.14, 'sawtooth', 0.1);
        this.tone(150, t + 0.28, 0.3, 'sawtooth', 0.1);
        break;
      case 'won':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, t + i * 0.1, 0.14, 'square', 0.12));
        break;
    }
  }

  private tone(freq: number, at: number, duration: number, type: OscillatorType, gain = 0.15): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }
}

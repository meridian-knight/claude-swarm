/**
 * Optional vibration feedback. Only active where the Vibration API exists and
 * the device is touch-driven (Android Chrome and similar). iOS Safari has no
 * Vibration API, so there it silently does nothing; nothing in the UI promises it.
 */
export type VibratePattern = number | number[];

export class Haptics {
  readonly supported: boolean;
  lastPattern: VibratePattern | null = null;

  constructor() {
    this.supported =
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse)').matches;
  }

  /** A short tick when the swarm changes direction. */
  turn(): void {
    this.buzz(8);
  }

  /** A slightly longer pulse when a new bot joins. */
  spawn(): void {
    this.buzz(15);
  }

  /** A short pattern on game over. */
  over(): void {
    this.buzz([30, 40, 60]);
  }

  private buzz(pattern: VibratePattern): void {
    if (!this.supported) return;
    try {
      // Returns false when the call is ignored (no user activation yet); harmless.
      if (navigator.vibrate(pattern)) this.lastPattern = pattern;
    } catch {
      // Ignore: vibration is a nicety, never a requirement.
    }
  }
}

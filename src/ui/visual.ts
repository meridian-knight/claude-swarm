/**
 * Render-side bookkeeping that reacts to game events: previous positions for
 * interpolation, short-lived animation timers and particles. Nothing in here
 * feeds back into game logic.
 */
import { VECTORS } from '../game/directions';
import type { Direction, GameEvent, GameState, Point } from '../game/types';

export interface Particle {
  /** Cell-space position at birth. */
  x: number;
  y: number;
  /** Cells per second. */
  vx: number;
  vy: number;
  born: number;
  life: number;
  colour: string;
}

export interface Bump {
  dir: Direction;
  start: number;
}

export const BUMP_MS = 150;
export const SQUASH_MS = 150;
export const FLASH_MS = 260;
export const BLINK_MS = 160;
export const DEATH_DIM_START_MS = 150;
export const SHAKE_MS = 120;
export const WIN_CHOMP_MS = 500;

const SPARK_COLOURS = ['#f3e6cf', '#f7c948', '#f4a97a', '#f3e6cf', '#f7c948', '#d97757'];

export class VisualState {
  prevBots: readonly Point[] = [];
  legFrame: 0 | 1 = 0;
  bump: Bump | null = null;
  chompTick = -1;
  spawnedAt = Number.NEGATIVE_INFINITY;
  startedAt = Number.NEGATIVE_INFINITY;
  overAt: number | null = null;
  wonAt: number | null = null;
  particles: Particle[] = [];
  reducedMotion = false;

  constructor() {
    if (typeof window !== 'undefined' && 'matchMedia' in window) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = mq.matches;
      mq.addEventListener('change', (e) => {
        this.reducedMotion = e.matches;
      });
    }
  }

  /** Call after every state transition with the state before and after it. */
  observe(prev: GameState, next: GameState, events: readonly GameEvent[], now: number): void {
    for (const event of events) {
      switch (event) {
        case 'started':
          this.prevBots = next.bots;
          this.startedAt = now;
          this.overAt = null;
          this.wonAt = null;
          this.bump = null;
          this.chompTick = -1;
          this.spawnedAt = Number.NEGATIVE_INFINITY;
          this.particles = [];
          break;
        case 'moved': {
          const last = prev.bots.length - 1;
          this.prevBots = last >= 0 ? next.bots.map((_, i) => prev.bots[Math.min(i, last)]!) : next.bots;
          this.legFrame = this.legFrame === 0 ? 1 : 0;
          break;
        }
        case 'spawned': {
          this.spawnedAt = now;
          this.chompTick = next.tick;
          const head = next.bots[0];
          if (head && !this.reducedMotion) this.burst(head, now, 6, 220);
          break;
        }
        case 'over':
          this.overAt = now;
          this.prevBots = next.bots;
          this.bump = this.reducedMotion ? null : { dir: next.dir, start: now };
          break;
        case 'won':
          this.wonAt = now;
          this.prevBots = next.bots;
          if (!this.reducedMotion) {
            for (let k = 0; k < 8; k++) {
              const cell = { x: Math.floor(Math.random() * next.cols), y: Math.floor(Math.random() * next.rows) };
              this.burst(cell, now + k * 90, 6, 320);
            }
          }
          break;
        case 'paused':
        case 'resumed':
          break;
      }
    }
  }

  /** Drops particles that have finished. */
  prune(now: number): void {
    if (this.particles.length === 0) return;
    this.particles = this.particles.filter((p) => now - p.born < p.life);
  }

  private burst(cell: Point, born: number, count: number, life: number): void {
    for (let k = 0; k < count; k++) {
      const angle = (Math.PI * 2 * k) / count + Math.random() * 0.6;
      const speed = 2.5 + Math.random() * 1.5;
      this.particles.push({
        x: cell.x + 0.5,
        y: cell.y + 0.5,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born,
        life,
        colour: SPARK_COLOURS[k % SPARK_COLOURS.length]!,
      });
    }
  }

  /** Visual offset (in cells) of the head during the collision bump. */
  bumpOffset(now: number): Point {
    if (!this.bump) return { x: 0, y: 0 };
    const t = (now - this.bump.start) / BUMP_MS;
    if (t < 0 || t >= 1) return { x: 0, y: 0 };
    const k = Math.sin(Math.PI * t) * 0.35;
    const v = VECTORS[this.bump.dir];
    return { x: v.x * k, y: v.y * k };
  }
}

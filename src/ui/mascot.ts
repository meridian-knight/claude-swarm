/**
 * The start-screen mascot: the in-game leader bot drawn large, with idle
 * bounce, blinks, a look-around, and a hop when hovered or tapped.
 */
import type { Direction } from '../game/types';
import { botSprite, SPRITE_PX, type Face, type Gaze, type LegFrame } from './sprites';

const BLINK_MS = 160;
const HOP_MS = 520;
const SPIN_MS = 400;
const LOOK_EVERY_MS = 5000;
const LOOK_MS = 900;
const SPIN_HOVERS = 4;
const SPIN_WINDOW_MS = 3000;

const SPIN_ORDER: readonly Direction[] = ['up', 'right', 'down', 'left'];

export type MascotMode = 'idle' | 'over' | 'won';

/** Draws one static leader bot into a canvas (used for the header brand mark). */
export function drawStaticBot(canvas: HTMLCanvasElement, cssScale: number, face: Face = 'open'): void {
  const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
  const pixel = cssScale * dpr;
  canvas.width = SPRITE_PX * pixel;
  canvas.height = SPRITE_PX * pixel;
  canvas.style.width = `${SPRITE_PX * cssScale}px`;
  canvas.style.height = `${SPRITE_PX * cssScale}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(botSprite({ kind: 'head', dir: 'right', legFrame: 0, face, tone: 'leader', gaze: 'centre' }, pixel), 0, 0);
}

export class Mascot {
  private mode: MascotMode = 'idle';
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 5;
  private pixel = 1;
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private pointer: { x: number; y: number } | null = null;
  private hopStart = Number.NEGATIVE_INFINITY;
  private spinStart = Number.NEGATIVE_INFINITY;
  private blinkStart = Number.NEGATIVE_INFINITY;
  private nextBlinkAt = 0;
  private lookStart = Number.NEGATIVE_INFINITY;
  private nextLookAt = 0;
  private hovers: number[] = [];
  private lastKey = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion: () => boolean,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;

    canvas.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointer = { x: e.offsetX, y: e.offsetY };
      this.poke(performance.now());
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.pointer = { x: e.offsetX, y: e.offsetY };
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
    });
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (e.pointerType === 'touch') this.poke(performance.now());
    });
  }

  /** Sizes the sprite to the title: 6x beside a 24px title, 5x on phones, 4x on small phones. */
  fit(titleFontPx: number): void {
    this.scale = titleFontPx >= 22 ? 6 : titleFontPx >= 19 ? 5 : 4;
    const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
    this.pixel = this.scale * dpr;
    this.canvas.width = SPRITE_PX * this.pixel;
    this.canvas.height = SPRITE_PX * this.pixel;
    this.canvas.style.width = `${SPRITE_PX * this.scale}px`;
    this.canvas.style.height = `${SPRITE_PX * this.scale}px`;
    this.cache.clear();
    this.lastKey = '';
  }

  /** Start screen (idle animations), game over (static dizzy face) or win (open face, bounce). */
  setMode(mode: MascotMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.lastKey = '';
    this.canvas.dataset.mode = mode;
  }

  /** Hover or tap: hop (or just blink under reduced motion). Ignored on the game-over face. */
  poke(now: number): void {
    if (this.mode === 'over') return;
    if (this.reducedMotion()) {
      this.blinkStart = now;
      return;
    }
    this.hovers = this.hovers.filter((t) => now - t < SPIN_WINDOW_MS);
    this.hovers.push(now);
    if (this.hovers.length >= SPIN_HOVERS) {
      this.hovers = [];
      this.spinStart = now;
    } else if (now - this.hopStart >= HOP_MS) {
      this.hopStart = now;
    }
  }

  private gazeFromPointer(): Gaze {
    if (!this.pointer) return 'centre';
    const size = SPRITE_PX * this.scale;
    const dx = this.pointer.x - size / 2;
    const dy = this.pointer.y - size / 2;
    const dead = size * 0.12;
    if (Math.abs(dx) < dead && Math.abs(dy) < dead) return 'centre';
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  draw(now: number): void {
    if (this.mode === 'over') {
      // The in-game death face, held still; the CSS sway (if any) handles motion.
      const key = 'centre:dizzy:0:0:1';
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.canvas.dataset.frame = key;
      const sprite = this.sprite('centre', 'dizzy', 0);
      const size = SPRITE_PX * this.pixel;
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.clearRect(0, 0, size, size);
      this.ctx.drawImage(sprite, 0, 0);
      return;
    }
    const reduced = this.reducedMotion();
    let face: Face = 'open';
    let gaze: Gaze = 'centre';
    let legs: LegFrame = 0;
    let lift = 0; // sprite pixels
    let squash = 1;

    if (reduced) {
      if (now - this.blinkStart < BLINK_MS) face = 'blink';
    } else {
      if (this.nextBlinkAt === 0) this.nextBlinkAt = now + 1500;
      if (now >= this.nextBlinkAt) {
        this.blinkStart = now;
        this.nextBlinkAt = now + 3000 + Math.random() * 1000;
      }
      if (now - this.blinkStart < BLINK_MS) face = 'blink';

      if (this.nextLookAt === 0) this.nextLookAt = now + 2500;
      if (now >= this.nextLookAt) {
        this.lookStart = now;
        this.nextLookAt = now + LOOK_EVERY_MS;
      }
      const look = now - this.lookStart;
      if (look >= 0 && look < LOOK_MS) gaze = look < 300 ? 'left' : look < 600 ? 'right' : 'centre';

      const bounce = Math.floor(now / 600) % 2;
      legs = bounce as LegFrame;
      lift = bounce ? 1 : 0;

      const spin = now - this.spinStart;
      const hop = now - this.hopStart;
      if (spin >= 0 && spin < SPIN_MS) {
        gaze = SPIN_ORDER[Math.floor((spin / SPIN_MS) * SPIN_ORDER.length) % SPIN_ORDER.length]!;
        legs = 2;
        lift = 2;
      } else if (hop >= 0 && hop < HOP_MS) {
        const t = hop / HOP_MS;
        lift = Math.round(Math.abs(Math.sin(t * Math.PI * 2)) * 3);
        legs = lift > 0 ? 2 : 0;
        if (t < 0.3) face = 'chomp';
        if (t > 0.9) squash = 0.85;
        if (this.pointer) gaze = this.gazeFromPointer();
      } else if (this.pointer) {
        gaze = this.gazeFromPointer();
      }
    }

    const key = `${gaze}:${face}:${legs}:${lift}:${squash}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.canvas.dataset.frame = key;

    const sprite = this.sprite(gaze, face, legs);
    const { ctx, pixel } = this;
    const size = SPRITE_PX * pixel;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    const h = Math.round(size * squash);
    ctx.drawImage(sprite, 0, size - h - lift * pixel, size, h);
  }

  private sprite(gaze: Gaze, face: Face, legs: LegFrame): HTMLCanvasElement {
    const key = `${gaze}:${face}:${legs}`;
    let s = this.cache.get(key);
    if (!s) {
      s = botSprite({ kind: 'head', dir: 'right', legFrame: legs, face, tone: 'leader', gaze }, this.pixel);
      this.cache.set(key, s);
    }
    return s;
  }
}

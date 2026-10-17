import type { GameState, Point } from '../game/types';
import { botSprite, SPRITE_PX, tokenSprite, type BotKind, type Face, type LegFrame, type Tone } from './sprites';
import {
  BLINK_MS,
  BUMP_MS,
  DEATH_DIM_START_MS,
  FLASH_MS,
  SHAKE_MS,
  SQUASH_MS,
  WIN_CHOMP_MS,
  type VisualState,
} from './visual';

const COLOURS = {
  screen: '#1c1712',
  grid: '#26201a',
  flash: '#f4a97a',
};

const TOKEN_PULSE_MS = 500;
const TWINKLE_EVERY_MS = 3200;
const TWINKLE_MS = 300;
/** The chip's four clipped corners, in sprite pixels. */
const TWINKLE_SPOTS: readonly Point[] = [
  { x: 2, y: 2 },
  { x: 9, y: 2 },
  { x: 9, y: 9 },
  { x: 2, y: 9 },
];

const VIGNETTE_IDLE = 0.6;
const VIGNETTE_PLAY = 0.38;
const VIGNETTE_FADE_MS = 300;

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 2;
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private vignette: HTMLCanvasElement | null = null;
  /** Where the head was last drawn, in cell units (for tests). */
  lastHead: Point = { x: 0, y: 0 };
  /** Where the token was last drawn, in cell units, or null (for tests). */
  lastToken: Point | null = null;
  /** Token pulse frame last drawn (for tests). */
  lastTokenFrame: 0 | 1 = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cols: number,
    private readonly rows: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.resize(canvas.clientWidth || 480, canvas.clientHeight || 480);
  }

  /** CSS pixels per cell as last laid out (equal on both axes by construction). */
  private cellCssValue = 24;

  /**
   * Sizes the canvas to fit `availableW × availableH` CSS pixels (the frame's
   * content box) with square cells on every axis. The backing store uses an
   * integer sprite scale; the CSS box is derived from one cell size, so the
   * canvas never relies on CSS max-width/max-height clamps (which can apply to
   * one axis only in some engines and stretch the grid). Works for rows ≠ cols.
   */
  resize(availableW: number, availableH: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const availW = Math.max(1, availableW);
    const availH = Math.max(1, availableH);
    // Largest square cell that fits both axes, in CSS px.
    const cellFit = Math.min(availW / this.cols, availH / this.rows);
    const exact = (cellFit * dpr) / SPRITE_PX;
    let scale = Math.max(1, Math.floor(exact));
    const crispFill = scale / exact;
    // On 1x displays a CSS downscale makes pixel rows uneven, so stay crisp
    // unless the crisp board would be tiny; high-DPR screens hide the difference.
    const threshold = dpr < 2 ? 0.75 : 0.9;
    if (crispFill < threshold) scale = Math.max(1, Math.ceil(exact));
    this.scale = scale;
    const cellDevice = SPRITE_PX * scale;
    this.canvas.width = this.cols * cellDevice;
    this.canvas.height = this.rows * cellDevice;
    // CSS cell: never larger than the backing cell at 1:1 and never larger than
    // what fits the content box (trimmed by a hair so rounding cannot overflow).
    // The same value drives both axes, so cells are square by construction.
    const cellCss = Math.floor(Math.min(cellFit, cellDevice / dpr) * 1000) / 1000;
    this.cellCssValue = cellCss;
    this.canvas.style.width = `${this.cols * cellCss}px`;
    this.canvas.style.height = `${this.rows * cellCss}px`;
    this.cache.clear();
    this.vignette = this.buildVignette();
  }

  /** CSS pixels per cell, for positioning DOM effects over the board. */
  get cellCss(): number {
    return this.cellCssValue;
  }

  /** Sizing facts for tests and the ?debug overlay. */
  boardMetrics(): {
    cols: number;
    rows: number;
    backing: [number, number];
    box: [number, number];
    cell: [number, number];
    dpr: number;
    squareOK: boolean;
  } {
    const b = this.canvas.getBoundingClientRect();
    const cellW = b.width / this.cols;
    const cellH = b.height / this.rows;
    return {
      cols: this.cols,
      rows: this.rows,
      backing: [this.canvas.width, this.canvas.height],
      box: [b.width, b.height],
      cell: [cellW, cellH],
      dpr: window.devicePixelRatio || 1,
      squareOK: Math.abs(cellW - cellH) < 0.05,
    };
  }

  private buildVignette(): HTMLCanvasElement | null {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const cx = c.width / 2;
    const cy = c.height / 2;
    const r = Math.max(c.width, c.height);
    const grad = ctx.createRadialGradient(cx, cy, r * 0.32, cx, cy, r * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  private sprite(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let s = this.cache.get(key);
    if (!s) {
      s = make();
      this.cache.set(key, s);
    }
    return s;
  }

  /** Snaps a cell-space coordinate to the sprite pixel grid. */
  private snap(cells: number): number {
    const { scale } = this;
    return Math.round((cells * SPRITE_PX * scale) / scale) * scale;
  }

  draw(state: GameState, visual: VisualState, now: number, progress: number): void {
    const { ctx, scale } = this;
    const cell = SPRITE_PX * scale;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const reduced = visual.reducedMotion;
    const t = reduced ? 1 : Math.max(0, Math.min(1, progress));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Death shake: a couple of pixels for a few frames, never under reduced motion.
    if (visual.overAt !== null && !reduced && now - visual.overAt < SHAKE_MS) {
      const k = 1 - (now - visual.overAt) / SHAKE_MS;
      ctx.translate(Math.round(Math.sin(now * 0.09) * 2 * scale * k), Math.round(Math.cos(now * 0.13) * 2 * scale * k));
    }

    ctx.fillStyle = COLOURS.screen;
    ctx.fillRect(-cell, -cell, w + cell * 2, h + cell * 2);

    ctx.fillStyle = COLOURS.grid;
    for (let x = 1; x < this.cols; x++) ctx.fillRect(x * cell, 0, 1, h);
    for (let y = 1; y < this.rows; y++) ctx.fillRect(0, y * cell, w, 1);

    // Particles sit under everything else so they never hide the head or a token.
    for (const p of visual.particles) {
      const age = now - p.born;
      if (age < 0 || age >= p.life) continue;
      const k = age / p.life;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.colour;
      const px = (p.x + (p.vx * age) / 1000) * cell;
      const py = (p.y + (p.vy * age) / 1000) * cell + k * k * cell * 0.4;
      const side = p.size * scale;
      ctx.fillRect(Math.round(px / scale) * scale, Math.round(py / scale) * scale, side, side);
    }
    ctx.globalAlpha = 1;

    if (state.token) {
      const { x, y } = state.token;
      const pulse = reduced ? 0 : ((Math.floor(now / TOKEN_PULSE_MS) % 2) as 0 | 1);
      const sprite = this.sprite(`token:${pulse}:${scale}`, () => tokenSprite(pulse, scale));
      ctx.drawImage(sprite, x * cell, y * cell);
      this.lastToken = { x, y };
      this.lastTokenFrame = pulse;

      // Occasional twinkle: one cream pixel hopping around the clipped corners.
      if (!reduced) {
        const phase = (now + (x * 97 + y * 31) * 13) % TWINKLE_EVERY_MS;
        if (phase < TWINKLE_MS) {
          const spot = TWINKLE_SPOTS[Math.floor(phase / 100) % TWINKLE_SPOTS.length]!;
          ctx.fillStyle = '#fff6e6';
          ctx.fillRect(x * cell + spot.x * scale, y * cell + spot.y * scale, scale, scale);
        }
      }
    } else {
      this.lastToken = null;
    }

    const n = state.bots.length;
    const aligned = visual.prevBots.length === n;
    const idle = state.status === 'idle';
    const breathe = idle && !reduced ? Math.floor(now / 600) % 2 : 0;
    const dimPerBot = n > 0 ? Math.min(5, 250 / n) : 0;
    const sinceOver = visual.overAt === null ? -1 : now - visual.overAt;
    const sinceWon = visual.wonAt === null ? -1 : now - visual.wonAt;
    const justStarted = now - visual.startedAt < BLINK_MS;
    const bump = visual.bumpOffset(now);

    for (let i = n - 1; i >= 0; i--) {
      const cur = state.bots[i]!;
      const prev = aligned ? visual.prevBots[i]! : cur;
      let fx = prev.x + (cur.x - prev.x) * t;
      let fy = prev.y + (cur.y - prev.y) * t;
      const isHead = i === 0;
      if (isHead) {
        fx += bump.x;
        fy += bump.y;
        if (breathe) fy -= 1 / SPRITE_PX;
      }

      const kind: BotKind = isHead ? 'head' : 'body';
      let face: Face = 'open';
      if (sinceOver >= 0 && isHead && (reduced || sinceOver >= BUMP_MS)) face = 'dizzy';
      else if (sinceWon >= 0 && sinceWon < WIN_CHOMP_MS) face = 'chomp';
      else if (justStarted || ((state.tick + i * 7) % 41 === 0 && !idle && sinceOver < 0)) face = 'blink';
      else if (isHead && state.tick === visual.chompTick) face = 'chomp';

      let tone: Tone = isHead ? 'leader' : i % 2 === 1 ? 'a' : 'b';
      if (sinceOver >= 0 && sinceOver >= DEATH_DIM_START_MS + (n - 1 - i) * dimPerBot && !isHead) tone = 'dim';

      let legs: LegFrame = idle ? (breathe as LegFrame) : (((visual.legFrame + i) & 1) as LegFrame);
      const squashAge = now - visual.spawnedAt;
      const squashing = !reduced && i === n - 1 && n > 1 && squashAge >= 0 && squashAge < SQUASH_MS;
      if (squashing) legs = 2;

      const sprite = this.sprite(`${kind}:${state.dir}:${legs}:${face}:${tone}:${scale}`, () =>
        botSprite({ kind, dir: state.dir, legFrame: legs, face, tone }, scale),
      );
      const dx = this.snap(fx);
      const dy = this.snap(fy);
      if (squashing) {
        const s = 0.6 + 0.4 * easeOut(squashAge / SQUASH_MS);
        const size = Math.round((cell * s) / scale) * scale;
        ctx.drawImage(sprite, dx + Math.round((cell - size) / 2), dy + (cell - size), size, size);
      } else {
        ctx.drawImage(sprite, dx, dy);
      }
      if (isHead) this.lastHead = { x: dx / cell, y: dy / cell };
    }

    // Spawn flash ring around the head.
    const sinceSpawn = now - visual.spawnedAt;
    if (sinceSpawn >= 0 && sinceSpawn < FLASH_MS && state.bots[0]) {
      const head = state.bots[0];
      const k = sinceSpawn / FLASH_MS;
      ctx.globalAlpha = reduced ? 0.8 : 1 - k;
      ctx.strokeStyle = COLOURS.flash;
      ctx.lineWidth = scale;
      const grow = reduced ? scale : k * cell * 0.6;
      ctx.strokeRect(head.x * cell - grow, head.y * cell - grow, cell + grow * 2, cell + grow * 2);
      ctx.globalAlpha = 1;
    }

    if (this.vignette) {
      const sinceStart = now - visual.startedAt;
      const playing = state.status === 'running' || state.status === 'paused';
      let alpha = playing ? VIGNETTE_PLAY : VIGNETTE_IDLE;
      if (playing && sinceStart >= 0 && sinceStart < VIGNETTE_FADE_MS && !reduced) {
        alpha = VIGNETTE_IDLE + (VIGNETTE_PLAY - VIGNETTE_IDLE) * (sinceStart / VIGNETTE_FADE_MS);
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.vignette, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

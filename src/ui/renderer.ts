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
  /** Device pixels per board cell (a whole number: the canvas maps 1:1 to device pixels). */
  private cellDevice = 24;
  /** Device pixels per sprite pixel (cellDevice / 12, possibly fractional). */
  private scale = 2;
  private dpr = 1;
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

  /**
   * Sizes the canvas to fit `availableW × availableH` CSS pixels (the frame's
   * content box). One rule: a cell is a whole number of device pixels, the
   * backing store is `cols × cellDevice`, and the CSS box is exactly
   * `backing / devicePixelRatio`. The canvas therefore maps 1:1 to device
   * pixels and is never resampled by the browser; resampling is what dropped
   * the 1-px grid lines on phones (a 960 px backing drawn into 927 device px
   * lost every other line under nearest-neighbour sampling). Cells are square
   * by construction and no CSS clamps are involved. Works for rows ≠ cols.
   */
  resize(availableW: number, availableH: number): void {
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.max(1, availableW);
    const availH = Math.max(1, availableH);
    // Largest square cell that fits both axes, in CSS px, then in whole device px.
    const cellFit = Math.min(availW / this.cols, availH / this.rows);
    // Below 12 device px per cell (a collapsed frame) sprites lose pixels, but
    // the canvas still fits the box and still maps 1:1.
    const largest = Math.max(1, Math.floor(cellFit * dpr));
    // The CSS box must also be a whole number of CSS px: engines position a
    // fractional box (e.g. 940 device px = 313.33 CSS px at 3x) off the pixel
    // grid and drift or drop 1 px lines even at a 1:1 size. Take the largest
    // cell within 10% of the fit whose box is whole on both axes; if the ratio
    // allows none (e.g. 2.75x needs steps of 11 px), fall back to the plain fit.
    const wholeCss = (c: number): boolean => {
      const w = (this.cols * c) / dpr;
      const h = (this.rows * c) / dpr;
      return Math.abs(w - Math.round(w)) < 1e-6 && Math.abs(h - Math.round(h)) < 1e-6;
    };
    let cellDevice = largest;
    for (let c = largest; c >= Math.max(1, Math.ceil(largest * 0.9)); c--) {
      if (wholeCss(c)) {
        cellDevice = c;
        break;
      }
    }
    // Prefer uniform sprite pixels (a sprite multiple) when that costs little
    // board area; on 1x displays uneven pixels show more, so accept a bigger loss.
    const crisp = SPRITE_PX * Math.floor(cellDevice / SPRITE_PX);
    const threshold = dpr < 2 ? 0.75 : 0.9;
    if (crisp >= cellDevice * threshold && (wholeCss(crisp) || !wholeCss(cellDevice))) cellDevice = crisp;
    this.dpr = dpr;
    this.cellDevice = cellDevice;
    this.scale = cellDevice / SPRITE_PX;
    this.canvas.width = this.cols * cellDevice;
    this.canvas.height = this.rows * cellDevice;
    // Exact CSS size (no trimming: even a 0.999 factor would resample).
    this.canvas.style.width = `${(this.cols * cellDevice) / dpr}px`;
    this.canvas.style.height = `${(this.rows * cellDevice) / dpr}px`;
    this.cache.clear();
    this.vignette = this.buildVignette();
  }

  /** CSS pixels per cell, for positioning DOM effects over the board. */
  get cellCss(): number {
    return this.cellDevice / this.dpr;
  }

  /** Sizing facts for tests and the ?debug overlay. */
  boardMetrics(): {
    cols: number;
    rows: number;
    backing: [number, number];
    box: [number, number];
    cell: [number, number];
    cellDevice: number;
    dpr: number;
    squareOK: boolean;
    oneToOne: boolean;
  } {
    const b = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cellW = b.width / this.cols;
    const cellH = b.height / this.rows;
    return {
      cols: this.cols,
      rows: this.rows,
      backing: [this.canvas.width, this.canvas.height],
      box: [b.width, b.height],
      cell: [cellW, cellH],
      cellDevice: this.cellDevice,
      dpr,
      squareOK: Math.abs(cellW - cellH) < 0.05,
      // Layout rects are reported at 1/64 CSS px, so allow that much (×dpr) slack.
      oneToOne: Math.abs(b.width * dpr - this.canvas.width) < 0.05 && Math.abs(b.height * dpr - this.canvas.height) < 0.05,
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

  /** Snaps a cell-space coordinate to the sprite pixel grid, in whole device px. */
  private snap(cells: number): number {
    return Math.round(Math.round(cells * SPRITE_PX) * this.scale);
  }

  /** Device-pixel offset of sprite pixel `i` within a cell (matches the sprite rasteriser). */
  private px(i: number): number {
    return Math.round(i * this.scale);
  }

  draw(state: GameState, visual: VisualState, now: number, progress: number): void {
    const { ctx, scale } = this;
    const cell = this.cellDevice;
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
      const side = Math.max(1, Math.round(p.size * scale));
      ctx.fillRect(this.px(Math.round(px / scale)), this.px(Math.round(py / scale)), side, side);
    }
    ctx.globalAlpha = 1;

    if (state.token) {
      const { x, y } = state.token;
      const pulse = reduced ? 0 : ((Math.floor(now / TOKEN_PULSE_MS) % 2) as 0 | 1);
      const sprite = this.sprite(`token:${pulse}:${cell}`, () => tokenSprite(pulse, scale));
      ctx.drawImage(sprite, x * cell, y * cell);
      this.lastToken = { x, y };
      this.lastTokenFrame = pulse;

      // Occasional twinkle: one cream pixel hopping around the clipped corners.
      if (!reduced) {
        const phase = (now + (x * 97 + y * 31) * 13) % TWINKLE_EVERY_MS;
        if (phase < TWINKLE_MS) {
          const spot = TWINKLE_SPOTS[Math.floor(phase / 100) % TWINKLE_SPOTS.length]!;
          ctx.fillStyle = '#fff6e6';
          const sx = this.px(spot.x);
          const sy = this.px(spot.y);
          ctx.fillRect(x * cell + sx, y * cell + sy, this.px(spot.x + 1) - sx, this.px(spot.y + 1) - sy);
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

      // Only the head's eyes follow the heading, so body sprites share one cache entry per look.
      const gazeKey = isHead ? state.dir : '-';
      const sprite = this.sprite(`${kind}:${gazeKey}:${legs}:${face}:${tone}:${cell}`, () =>
        botSprite({ kind, dir: state.dir, legFrame: legs, face, tone }, scale),
      );
      const dx = this.snap(fx);
      const dy = this.snap(fy);
      if (squashing) {
        const s = 0.6 + 0.4 * easeOut(squashAge / SQUASH_MS);
        const size = Math.max(1, Math.round(cell * s));
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
      ctx.lineWidth = Math.max(1, Math.round(scale));
      const grow = reduced ? Math.round(scale) : k * cell * 0.6;
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

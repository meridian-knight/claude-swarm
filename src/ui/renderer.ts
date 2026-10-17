import type { GameState } from '../game/types';
import { botSprite, SPRITE_PX, tokenSprite, type BotKind } from './sprites';

export interface FrameInfo {
  /** Alternates every simulation tick so the legs appear to walk. */
  legFrame: 0 | 1;
  /** High-resolution timestamp in ms. */
  time: number;
  /** Until when the head should show the "spawned" flash ring. */
  flashUntil: number;
}

const COLOURS = {
  screen: '#1c1712',
  grid: '#26201a',
  flash: '#f4a97a',
};

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 2;
  private readonly cache = new Map<string, HTMLCanvasElement>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cols: number,
    private readonly rows: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.resize(canvas.clientWidth || 480);
  }

  /**
   * Picks an integer pixel scale for the backing store. If the largest scale
   * that fits leaves more than ~10% of the space unused (typical on phones with
   * fractional device pixel ratios), we render one step bigger and let CSS
   * shrink it, so the board always fills the screen area.
   */
  resize(cssPx: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const perSide = Math.max(this.cols, this.rows) * SPRITE_PX;
    const exact = (cssPx * dpr) / perSide;
    let scale = Math.max(1, Math.floor(exact));
    const crispFill = scale / exact;
    if (crispFill < 0.9) scale = Math.max(1, Math.ceil(exact));
    this.scale = scale;
    const cell = SPRITE_PX * scale;
    this.canvas.width = this.cols * cell;
    this.canvas.height = this.rows * cell;
    const cssW = Math.min(cssPx, this.canvas.width / dpr);
    const cssH = cssW * (this.rows / this.cols);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.cache.clear();
  }

  /** CSS pixels per cell, for positioning DOM effects over the board. */
  get cellCss(): number {
    return this.canvas.clientWidth / this.cols;
  }

  private sprite(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let s = this.cache.get(key);
    if (!s) {
      s = make();
      this.cache.set(key, s);
    }
    return s;
  }

  draw(state: GameState, frame: FrameInfo): void {
    const { ctx, scale } = this;
    const cell = SPRITE_PX * scale;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = COLOURS.screen;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = COLOURS.grid;
    for (let x = 1; x < this.cols; x++) ctx.fillRect(x * cell, 0, 1, h);
    for (let y = 1; y < this.rows; y++) ctx.fillRect(0, y * cell, w, 1);

    if (state.token) {
      const pulse = (Math.floor(frame.time / 260) % 2) as 0 | 1;
      const bob = Math.floor(frame.time / 520) % 2 === 0 ? 0 : -scale;
      const sprite = this.sprite(`token:${pulse}:${scale}`, () => tokenSprite(pulse, scale));
      ctx.drawImage(sprite, state.token.x * cell, state.token.y * cell + bob);
    }

    for (let i = state.bots.length - 1; i >= 0; i--) {
      const bot = state.bots[i]!;
      const kind: BotKind = i === 0 ? 'head' : 'body';
      const legs = ((frame.legFrame + i) & 1) as 0 | 1;
      const dir = kind === 'head' ? state.dir : 'right';
      const sprite = this.sprite(`${kind}:${dir}:${legs}:${scale}`, () => botSprite(kind, dir, legs, scale));
      ctx.drawImage(sprite, bot.x * cell, bot.y * cell);
    }

    if (frame.time < frame.flashUntil && state.bots[0]) {
      const head = state.bots[0];
      const remaining = (frame.flashUntil - frame.time) / 260;
      ctx.globalAlpha = Math.max(0, Math.min(1, remaining));
      ctx.strokeStyle = COLOURS.flash;
      ctx.lineWidth = scale;
      const grow = (1 - remaining) * cell * 0.6;
      ctx.strokeRect(head.x * cell - grow, head.y * cell - grow, cell + grow * 2, cell + grow * 2);
      ctx.globalAlpha = 1;
    }
  }
}

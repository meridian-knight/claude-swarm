/**
 * Locally drawn pixel art. Every sprite is a 12x12 grid of palette keys that
 * gets painted onto a small canvas at a device-pixel scale (integer or
 * fractional, with rounded pixel edges), so the result stays crisp at any
 * board size without the browser resampling it.
 */
import type { Direction } from '../game/types';

export const SPRITE_PX = 12;

export type BotKind = 'head' | 'body';
export type Face = 'open' | 'blink' | 'chomp' | 'dizzy';
export type Tone = 'leader' | 'a' | 'b' | 'dim';
export type LegFrame = 0 | 1 | 2;

export type Gaze = Direction | 'centre';

export interface BotSpriteOptions {
  kind: BotKind;
  dir: Direction;
  legFrame: LegFrame;
  face: Face;
  tone: Tone;
  /** Where the leader's eyes point; defaults to the travel direction. */
  gaze?: Gaze;
}

const SHARED: Readonly<Record<string, string>> = {
  E: '#2a1810', // eye / mouth
  M: '#160c07', // open mouth
  G: '#ffe9d6', // eye glint
  K: '#f7c948', // token core
  A: '#f3e6cf', // antenna / cream
  S: '#b8862a', // halo / twinkle
  C: '#f3e6cf', // chip body
  H: '#fff6e6', // chip highlight
  T: '#d97757', // chip outline / spark arms
  P: '#9a4f36', // chip pins
  y: '#ffd45a', // bright core (pulse frame)
};

/** Body colours per tone: outline, fill, highlight, legs, eyelid. */
const TONES: Readonly<Record<Tone, Readonly<Record<string, string>>>> = {
  leader: { D: '#7a3b22', O: '#e8895f', L: '#f8b98e', g: '#5a2c1a', d: '#c76a4a' },
  a: { D: '#7a3b22', O: '#d97757', L: '#f4a97a', g: '#5a2c1a', d: '#b85f42' },
  b: { D: '#73361f', O: '#cf6d4e', L: '#eb9c70', g: '#52281a', d: '#ad5839' },
  dim: { D: '#4a3028', O: '#8a6a5c', L: '#a07f70', g: '#3d261b', d: '#7a5a4c' },
};

type Grid = string[][];

function blank(): Grid {
  return Array.from({ length: SPRITE_PX }, () => Array.from({ length: SPRITE_PX }, () => '.'));
}

function put(grid: Grid, x: number, y: number, key: string): void {
  if (x < 0 || y < 0 || x >= SPRITE_PX || y >= SPRITE_PX) return;
  grid[y]![x] = key;
}

/**
 * Device-pixel edges of the 12 sprite pixels at `scale` device px per sprite
 * pixel. The scale may be fractional: edges are rounded so the sprite covers
 * exactly `round(12 × scale)` pixels and neighbouring widths differ by at most
 * one, which keeps the art crisp without any later resampling. Integer scales
 * give the plain `i × scale` edges.
 */
export function pixelEdges(scale: number): number[] {
  const edges: number[] = [];
  for (let i = 0; i <= SPRITE_PX; i++) edges.push(Math.round(i * scale));
  return edges;
}

function paint(grid: Grid, palette: Readonly<Record<string, string>>, scale: number): HTMLCanvasElement {
  const edges = pixelEdges(scale);
  const size = edges[SPRITE_PX]!;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  grid.forEach((row, y) => {
    row.forEach((key, x) => {
      const colour = palette[key];
      if (!colour) return;
      ctx.fillStyle = colour;
      ctx.fillRect(edges[x]!, edges[y]!, edges[x + 1]! - edges[x]!, edges[y + 1]! - edges[y]!);
    });
  });
  return canvas;
}

const LEGS: Readonly<Record<LegFrame, readonly number[]>> = {
  0: [1, 4, 7, 10],
  1: [2, 4, 7, 9],
  2: [2, 5, 6, 9],
};

/**
 * A boxy orange bot: flat-topped rounded body, two eyes, a mouth and four
 * little legs. The leader gets a lighter tone, a cream antenna pixel and
 * eyes that look where it is going.
 */
export function botSprite(opts: BotSpriteOptions, scale: number): HTMLCanvasElement {
  const { kind, dir, legFrame, face, tone } = opts;
  const gaze: Gaze = opts.gaze ?? dir;
  const g = blank();

  // Body: x 0..11, y 1..8 with 1px rounded corners.
  for (let x = 1; x <= 10; x++) {
    put(g, x, 1, 'D');
    put(g, x, 8, 'D');
  }
  for (let y = 2; y <= 7; y++) {
    put(g, 0, y, 'D');
    put(g, 11, y, 'D');
    for (let x = 1; x <= 10; x++) put(g, x, y, 'O');
  }
  put(g, 1, 2, 'L');
  put(g, 2, 2, 'L');
  put(g, 1, 3, 'L');

  if (kind === 'head') {
    put(g, 5, 0, 'A');
  }

  // Eyes: 2x2 blocks at x 3-4 and 7-8, rows 3-4; the leader's shift toward travel.
  let ex = 0;
  let ey = 0;
  if (kind === 'head' && face !== 'dizzy') {
    if (gaze === 'left') ex = -1;
    if (gaze === 'right') ex = 1;
    if (gaze === 'up') ey = -1;
    if (gaze === 'down') ey = 1;
  }

  if (face === 'dizzy') {
    for (const cx of [2, 6]) {
      put(g, cx, 3, 'E');
      put(g, cx + 2, 3, 'E');
      put(g, cx + 1, 4, 'E');
      put(g, cx, 5, 'E');
      put(g, cx + 2, 5, 'E');
    }
  } else if (face === 'blink') {
    for (const bx of [3, 7]) {
      put(g, bx + ex, 4 + ey, 'E');
      put(g, bx + 1 + ex, 4 + ey, 'E');
    }
  } else {
    for (const bx of [3, 7]) {
      if (kind === 'head') {
        put(g, bx + ex, 3 + ey, 'E');
        put(g, bx + 1 + ex, 3 + ey, 'E');
        put(g, bx + ex, 4 + ey, 'E');
        put(g, bx + 1 + ex, 4 + ey, 'E');
        put(g, bx + ex, 3 + ey, 'G');
      } else {
        put(g, bx, 3, 'd');
        put(g, bx + 1, 3, 'd');
        put(g, bx, 4, 'E');
        put(g, bx + 1, 4, 'E');
      }
    }
  }

  // Mouth.
  if (face === 'chomp') {
    for (let x = 4; x <= 7; x++) {
      put(g, x, 6, 'M');
      put(g, x, 7, 'M');
    }
  } else if (face === 'dizzy') {
    for (let x = 4; x <= 7; x++) put(g, x, 7, 'E');
  } else if (kind === 'head') {
    for (let x = 4; x <= 7; x++) put(g, x, 6, 'E');
  } else {
    put(g, 5, 6, 'E');
    put(g, 6, 6, 'E');
  }

  // Legs.
  for (const x of LEGS[legFrame]) {
    put(g, x, 9, 'g');
    put(g, x, 10, 'g');
  }

  return paint(g, { ...SHARED, ...TONES[tone] }, scale);
}

/**
 * A small AI chip: clipped-corner square with an orange outline, warm cream
 * body, short connector pins and a spark in the middle. Frame 1 is the pulse
 * (brighter core, cream arms); nothing moves between frames.
 */
export function tokenSprite(frame: 0 | 1, scale: number): HTMLCanvasElement {
  const g = blank();
  // Outline 2..9 with clipped corners.
  for (let i = 3; i <= 8; i++) {
    put(g, i, 2, 'T');
    put(g, i, 9, 'T');
    put(g, 2, i, 'T');
    put(g, 9, i, 'T');
  }
  // Body.
  for (let y = 3; y <= 8; y++) for (let x = 3; x <= 8; x++) put(g, x, y, 'C');
  put(g, 3, 3, 'H');
  put(g, 4, 3, 'H');
  put(g, 3, 4, 'H');
  // Pins: two per side.
  for (const i of [4, 7]) {
    put(g, i, 1, 'P');
    put(g, i, 10, 'P');
    put(g, 1, i, 'P');
    put(g, 10, i, 'P');
  }
  // Spark: 2x2 core with 1px arms.
  const core = frame === 1 ? 'y' : 'K';
  const arm = frame === 1 ? 'A' : 'T';
  for (const y of [5, 6]) for (const x of [5, 6]) put(g, x, y, core);
  for (const c of [5, 6]) {
    put(g, c, 3, arm);
    put(g, c, 8, arm);
    put(g, 3, c, arm);
    put(g, 8, c, arm);
  }
  return paint(g, SHARED, scale);
}

/**
 * Locally drawn pixel art. Every sprite is a 12x12 grid of palette keys that
 * gets painted onto a small canvas at an integer scale, so the result stays
 * crisp at any board size.
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
  A: '#f3e6cf', // token arm / antenna
  S: '#b8862a', // token spark / halo
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

function paint(grid: Grid, palette: Readonly<Record<string, string>>, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_PX * scale;
  canvas.height = SPRITE_PX * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  grid.forEach((row, y) => {
    row.forEach((key, x) => {
      const colour = palette[key];
      if (!colour) return;
      ctx.fillStyle = colour;
      ctx.fillRect(x * scale, y * scale, scale, scale);
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

/** An eight-point spark with a faint halo on its wide frame. */
export function tokenSprite(frame: 0 | 1, scale: number): HTMLCanvasElement {
  const g = blank();
  const reach = frame === 0 ? 3 : 4;
  for (let i = 1; i <= reach; i++) {
    for (const c of [5, 6]) {
      put(g, c, 5 - i, 'A');
      put(g, c, 6 + i, 'A');
      put(g, 5 - i, c, 'A');
      put(g, 6 + i, c, 'A');
    }
  }
  if (frame === 1) {
    for (const c of [5, 6]) {
      put(g, c, 0, 'S');
      put(g, c, 11, 'S');
      put(g, 0, c, 'S');
      put(g, 11, c, 'S');
    }
  }
  const diag = frame === 0 ? [2] : [2, 3];
  for (const d of diag) {
    put(g, 5 - d, 5 - d, 'S');
    put(g, 6 + d, 5 - d, 'S');
    put(g, 5 - d, 6 + d, 'S');
    put(g, 6 + d, 6 + d, 'S');
  }
  for (const y of [5, 6]) for (const x of [5, 6]) put(g, x, y, 'K');
  return paint(g, SHARED, scale);
}

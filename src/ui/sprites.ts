/**
 * Locally drawn pixel art. Every sprite is a 12x12 grid of palette keys that
 * gets painted onto a small canvas at an integer scale, so the result stays
 * crisp at any board size.
 */
import type { Direction } from '../game/types';

export const SPRITE_PX = 12;

const PALETTE: Readonly<Record<string, string>> = {
  D: '#7a3b22', // outline
  O: '#d97757', // body
  L: '#f4a97a', // highlight
  E: '#2a1810', // eye / mouth
  G: '#ffe9d6', // eye glint
  g: '#5a2c1a', // leg
  K: '#f7c948', // token core
  A: '#f3e6cf', // token arm
  S: '#b8862a', // token spark
};

export type BotKind = 'head' | 'body';

type Grid = string[][];

function blank(): Grid {
  return Array.from({ length: SPRITE_PX }, () => Array.from({ length: SPRITE_PX }, () => '.'));
}

function put(grid: Grid, x: number, y: number, key: string): void {
  if (x < 0 || y < 0 || x >= SPRITE_PX || y >= SPRITE_PX) return;
  grid[y]![x] = key;
}

function paint(grid: Grid, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_PX * scale;
  canvas.height = SPRITE_PX * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  grid.forEach((row, y) => {
    row.forEach((key, x) => {
      const colour = PALETTE[key];
      if (!colour) return;
      ctx.fillStyle = colour;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    });
  });
  return canvas;
}

/** A boxy orange bot: rounded body, two eyes, a mouth and four little legs. */
export function botSprite(kind: BotKind, dir: Direction, legFrame: 0 | 1, scale: number): HTMLCanvasElement {
  const g = blank();

  // Body (x 1..10, y 1..8) with rounded corners.
  for (let x = 3; x <= 8; x++) {
    put(g, x, 1, 'D');
    put(g, x, 8, 'D');
  }
  for (const y of [2, 7]) {
    put(g, 2, y, 'D');
    put(g, 9, y, 'D');
    for (let x = 3; x <= 8; x++) put(g, x, y, 'O');
  }
  for (let y = 3; y <= 6; y++) {
    put(g, 1, y, 'D');
    put(g, 10, y, 'D');
    for (let x = 2; x <= 9; x++) put(g, x, y, 'O');
  }
  // Highlight.
  put(g, 3, 2, 'L');
  put(g, 4, 2, 'L');
  put(g, 2, 3, 'L');

  // Eyes.
  let ex = 0;
  let ey = 0;
  if (kind === 'head') {
    if (dir === 'left') ex = -1;
    if (dir === 'right') ex = 1;
    if (dir === 'up') ey = -1;
    if (dir === 'down') ey = 1;
  }
  const eyeRows = kind === 'head' ? [3, 4] : [4];
  for (const baseX of [3, 7]) {
    for (const row of eyeRows) {
      put(g, baseX + ex, row + ey, 'E');
      put(g, baseX + 1 + ex, row + ey, 'E');
    }
    if (kind === 'head') put(g, baseX + ex, 3 + ey, 'G');
  }

  // Mouth.
  if (kind === 'head') {
    for (let x = 4; x <= 7; x++) put(g, x, 6, 'E');
  } else {
    put(g, 5, 6, 'E');
    put(g, 6, 6, 'E');
  }

  // Legs (two walk frames).
  const legs = legFrame === 0 ? [2, 4, 7, 9] : [3, 4, 7, 8];
  for (const x of legs) {
    put(g, x, 9, 'g');
    put(g, x, 10, 'g');
  }

  return paint(g, scale);
}

/** An eight-point spark, loosely in the spirit of an asterisk token. */
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
  const diag = frame === 0 ? [2] : [2, 3];
  for (const d of diag) {
    put(g, 5 - d, 5 - d, 'S');
    put(g, 6 + d, 5 - d, 'S');
    put(g, 5 - d, 6 + d, 'S');
    put(g, 6 + d, 6 + d, 'S');
  }
  for (const y of [5, 6]) for (const x of [5, 6]) put(g, x, y, 'K');
  return paint(g, scale);
}

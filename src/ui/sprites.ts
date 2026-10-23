/**
 * Paints the shared 12x12 grids (./art) onto small canvases at a device-pixel
 * scale (integer or fractional, with rounded pixel edges), so sprites stay
 * crisp at any board size without the browser resampling them.
 */
import { botGrid, SPRITE_PX, tokenGrid, type Art, type BotSpriteOptions } from './art';

export { SPRITE_PX } from './art';
export type { BotKind, BotSpriteOptions, Face, Gaze, LegFrame, Tone } from './art';

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

function paint({ grid, palette }: Art, scale: number): HTMLCanvasElement {
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

export function botSprite(opts: BotSpriteOptions, scale: number): HTMLCanvasElement {
  return paint(botGrid(opts), scale);
}

export function tokenSprite(frame: 0 | 1, scale: number): HTMLCanvasElement {
  return paint(tokenGrid(frame), scale);
}

import { describe, expect, it } from 'vitest';
import { pixelEdges, SPRITE_PX } from '../../src/ui/sprites';

describe('pixelEdges', () => {
  it('reproduces plain integer scales', () => {
    for (const scale of [1, 2, 3, 4]) {
      const edges = pixelEdges(scale);
      expect(edges).toEqual(Array.from({ length: SPRITE_PX + 1 }, (_, i) => i * scale));
    }
  });

  it('covers exactly round(12 × scale) device pixels at fractional scales', () => {
    for (const scale of [46 / 12, 44 / 12, 22 / 12, 15 / 12, 2.5]) {
      const edges = pixelEdges(scale);
      expect(edges).toHaveLength(SPRITE_PX + 1);
      expect(edges[0]).toBe(0);
      expect(edges[SPRITE_PX]).toBe(Math.round(SPRITE_PX * scale));
      const widths = edges.slice(1).map((e, i) => e - edges[i]!);
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
      expect(widths.reduce((a, b) => a + b, 0)).toBe(Math.round(SPRITE_PX * scale));
    }
  });
});

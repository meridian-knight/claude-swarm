import type { Point } from '../game/types';

/** Short-lived DOM labels floating over the board (e.g. "Agent spawned!"). */
export class Effects {
  private current: HTMLElement | null = null;

  constructor(
    private readonly layer: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    /** CSS pixels per cell, as laid out by the renderer. */
    private readonly cellCss: () => number,
  ) {}

  spawned(at: Point): void {
    // Only one label at a time, so a fast streak never piles text over the board.
    this.current?.remove();
    const cell = this.cellCss();
    const node = document.createElement('div');
    node.className = 'effect-spawned';
    node.dataset.effect = 'spawned';
    node.textContent = 'Agent spawned!';
    node.style.left = `${this.canvas.offsetLeft + (at.x + 0.5) * cell}px`;
    node.style.top = `${this.canvas.offsetTop + at.y * cell}px`;
    this.layer.appendChild(node);
    this.current = node;
    const remove = (): void => {
      node.remove();
      if (this.current === node) this.current = null;
    };
    node.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, 900);
  }
}

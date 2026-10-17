import type { Point } from '../game/types';

/** Short-lived DOM labels floating over the board (e.g. "Agent spawned!"). */
export class Effects {
  constructor(
    private readonly layer: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly cols: number,
  ) {}

  spawned(at: Point): void {
    const cell = this.canvas.clientWidth / this.cols;
    const node = document.createElement('div');
    node.className = 'effect-spawned';
    node.dataset.effect = 'spawned';
    node.textContent = 'Agent spawned!';
    node.style.left = `${this.canvas.offsetLeft + (at.x + 0.5) * cell}px`;
    node.style.top = `${this.canvas.offsetTop + at.y * cell}px`;
    this.layer.appendChild(node);
    const remove = (): void => node.remove();
    node.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, 900);
  }
}

import type { Direction } from '../game/types';

export interface InputHandlers {
  onDirection(dir: Direction): void;
  /** Space key or the pause chip. */
  onPause(): void;
  /** Enter key: start, restart or resume. */
  onEnter(): void;
  /** The big overlay button: start, resume or restart depending on status. */
  onAction(): void;
  /** Any first user gesture (used to unlock audio). */
  onGesture(): void;
}

const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

const SWIPE_MIN_PX = 20;
const PRESSED_MS = 140;

export function bindInput(
  handlers: InputHandlers,
  elements: { canvas: HTMLCanvasElement; dpad: HTMLElement; action: HTMLButtonElement; pause: HTMLButtonElement },
): void {
  const pressTimers = new Map<Direction, number>();
  /** Lights up the matching D-pad button briefly (visible on touch layouts only). */
  const highlight = (dir: Direction): void => {
    const btn = elements.dpad.querySelector<HTMLElement>(`[data-dir="${dir}"]`);
    if (!btn) return;
    btn.classList.add('pressed');
    const existing = pressTimers.get(dir);
    if (existing !== undefined) window.clearTimeout(existing);
    pressTimers.set(
      dir,
      window.setTimeout(() => btn.classList.remove('pressed'), PRESSED_MS),
    );
  };
  const steer = (dir: Direction): void => {
    highlight(dir);
    handlers.onDirection(dir);
  };

  window.addEventListener(
    'keydown',
    (e) => {
      const dir = KEY_DIRECTIONS[e.key];
      if (dir) {
        e.preventDefault();
        handlers.onGesture();
        steer(dir);
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        handlers.onGesture();
        handlers.onPause();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.repeat) return;
        handlers.onGesture();
        handlers.onEnter();
      }
    },
    { passive: false },
  );

  // D-pad: react on pointerdown so taps feel instant.
  elements.dpad.addEventListener('pointerdown', (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-dir]');
    const dir = target?.dataset.dir as Direction | undefined;
    if (!dir) return;
    e.preventDefault();
    handlers.onGesture();
    steer(dir);
  });
  // Keyboard activation of d-pad buttons (Enter/Space on a focused button).
  elements.dpad.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-dir]');
    const dir = target?.dataset.dir as Direction | undefined;
    if (dir && (e as PointerEvent).pointerType === '') steer(dir);
  });

  elements.action.addEventListener('click', () => {
    handlers.onGesture();
    handlers.onAction();
    elements.action.blur();
  });
  elements.pause.addEventListener('click', () => {
    handlers.onGesture();
    handlers.onPause();
    elements.pause.blur();
  });

  // Swipe anywhere on the board.
  let start: { x: number; y: number; id: number } | null = null;
  elements.canvas.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    handlers.onGesture();
  });
  const finish = (e: PointerEvent): void => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 'right' : 'left');
    else steer(dy > 0 ? 'down' : 'up');
  };
  elements.canvas.addEventListener('pointerup', finish);
  elements.canvas.addEventListener('pointercancel', () => {
    start = null;
  });
}

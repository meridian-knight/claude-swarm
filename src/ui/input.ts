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
  /** When true (e.g. a dialog is open) no game input is processed. */
  isBlocked(): boolean;
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
/** A second D-pad arm pressed within this window counts as a diagonal slip and is ignored. */
const CHORD_MS = 60;

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
      if (handlers.isBlocked()) return;
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

  // D-pad: react on pointerdown so taps feel instant. Each pointer is tracked
  // so a held arm never repeats and a near-simultaneous second arm (a thumb
  // catching two arms) is ignored instead of queuing a second turn.
  const held = new Map<number, { dir: Direction; at: number }>();
  const release = (e: PointerEvent): void => {
    held.delete(e.pointerId);
  };
  elements.dpad.addEventListener('pointerdown', (e) => {
    if (handlers.isBlocked()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-dir]');
    const dir = target?.dataset.dir as Direction | undefined;
    if (!dir) return;
    e.preventDefault();
    const now = performance.now();
    let chord = false;
    for (const other of held.values()) {
      if (other.dir !== dir && now - other.at < CHORD_MS) chord = true;
    }
    held.set(e.pointerId, { dir, at: now });
    try {
      target?.setPointerCapture(e.pointerId);
    } catch {
      // Older browsers: capture is a nicety, not a requirement.
    }
    handlers.onGesture();
    if (!chord) steer(dir);
  });
  elements.dpad.addEventListener('pointerup', release);
  elements.dpad.addEventListener('pointercancel', release);
  elements.dpad.addEventListener('lostpointercapture', release);
  elements.dpad.addEventListener('contextmenu', (e) => e.preventDefault());
  // Keyboard activation of d-pad buttons (Enter/Space on a focused button):
  // a keyboard click has detail 0 in Chromium, Firefox and Safari.
  elements.dpad.addEventListener('click', (e) => {
    if (handlers.isBlocked()) return;
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-dir]');
    const dir = target?.dataset.dir as Direction | undefined;
    if (dir && e.detail === 0) steer(dir);
  });

  elements.action.addEventListener('click', () => {
    if (handlers.isBlocked()) return;
    handlers.onGesture();
    handlers.onAction();
    elements.action.blur();
  });
  elements.pause.addEventListener('click', () => {
    if (handlers.isBlocked()) return;
    handlers.onGesture();
    handlers.onPause();
    elements.pause.blur();
  });

  // Swipe anywhere on the board.
  let start: { x: number; y: number; id: number } | null = null;
  elements.canvas.addEventListener('pointerdown', (e) => {
    if (handlers.isBlocked()) return;
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

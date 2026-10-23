import type { Direction } from '../game/types';

export interface InputHandlers {
  onDirection(dir: Direction): void;
  /** Space key or the pause chip. */
  onPause(): void;
  /** Enter key or the big overlay button: start, resume or restart depending on status. */
  onAction(): void;
  /** Any user gesture (unlocks or resumes audio). */
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

/** Enter and Space on one of these are its own activation keys, not game input. */
const INTERACTIVE = 'button, a, input, select, textarea, [contenteditable]';

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
      // Browser and OS shortcuts (Cmd+S, Ctrl+A, Alt+D...) are not game input.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const dir = KEY_DIRECTIONS[e.key];
      if (dir) {
        e.preventDefault();
        handlers.onGesture();
        steer(dir);
        return;
      }
      if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
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
        handlers.onAction();
      }
    },
    { passive: false },
  );

  // D-pad: the whole pad square is the touch surface, so corners and the
  // gaps around the visible cross all count. The direction is the dominant
  // axis from the pad centre; the centre and the exact diagonals are dead so
  // a thumb can never produce two turns from one touch. Sliding the thumb
  // onto another arm while held turns again (rapid turns), a held arm never
  // repeats, and a second finger landing within CHORD_MS is ignored.
  const pad = elements.dpad;
  const held = new Map<number, { dir: Direction | null; at: number }>();
  const resolve = (e: PointerEvent): Direction | null => {
    const r = pad.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < 0.18) return null; // dead centre
    if (Math.abs(ax - ay) < 0.2 * Math.max(ax, ay)) return null; // diagonal band
    return ax > ay ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  };
  const showActive = (): void => {
    const active = [...held.values()].map((h) => h.dir).find((d) => d !== null) ?? null;
    if (active) pad.dataset.active = active;
    else delete pad.dataset.active;
  };
  const release = (e: PointerEvent): void => {
    held.delete(e.pointerId);
    showActive();
  };
  pad.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    handlers.onGesture();
    if (handlers.isBlocked()) return;
    const now = performance.now();
    let chord = false;
    for (const other of held.values()) {
      if (now - other.at < CHORD_MS) chord = true;
    }
    const dir = chord ? null : resolve(e);
    held.set(e.pointerId, { dir, at: now });
    try {
      pad.setPointerCapture(e.pointerId);
    } catch {
      // Older browsers: capture is a nicety, not a requirement.
    }
    showActive();
    if (dir) steer(dir);
  });
  pad.addEventListener('pointermove', (e) => {
    const entry = held.get(e.pointerId);
    if (!entry || handlers.isBlocked()) return;
    const dir = resolve(e);
    if (dir && dir !== entry.dir) {
      entry.dir = dir;
      showActive();
      steer(dir);
    }
  });
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('lostpointercapture', release);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  // Safari grants user activation for audio on pointerup/touchend rather than
  // pointerdown, so unlock again on the way up too.
  window.addEventListener('pointerup', () => handlers.onGesture(), { passive: true });
  window.addEventListener('touchend', () => handlers.onGesture(), { passive: true });
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
    try {
      elements.canvas.setPointerCapture(e.pointerId); // a swipe released off the board still counts
    } catch {
      // Capture is a nicety, not a requirement.
    }
  });
  const finish = (e: PointerEvent): void => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (handlers.isBlocked()) return;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 'right' : 'left');
    else steer(dy > 0 ? 'down' : 'up');
  };
  elements.canvas.addEventListener('pointerup', finish);
  elements.canvas.addEventListener('pointercancel', () => {
    start = null;
  });
}

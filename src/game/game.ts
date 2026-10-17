/**
 * Pure game logic for Claude Swarm. No DOM, no timers, no randomness except
 * the injected `Rng`. Every function returns a new state; nothing is mutated.
 */
import {
  BASE_TICK_MS,
  GRID_COLS,
  GRID_ROWS,
  MIN_TICK_MS,
  QUEUE_MAX,
  TICK_STEP_MS,
} from './config';
import { isOpposite, VECTORS } from './directions';
import { defaultRng, type Rng } from './rng';
import type { Direction, GameState, Point, StepResult } from './types';

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function createGame(cols = GRID_COLS, rows = GRID_ROWS): GameState {
  if (cols < 1 || rows < 1) throw new Error('Grid must be at least 1x1');
  return {
    cols,
    rows,
    bots: [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }],
    dir: 'right',
    queue: [],
    token: null,
    score: 0,
    status: 'idle',
    tick: 0,
  };
}

export function cellCount(state: GameState): number {
  return state.cols * state.rows;
}

export function isOccupied(state: GameState, p: Point): boolean {
  return state.bots.some((b) => samePoint(b, p));
}

export function isInside(state: GameState, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < state.cols && p.y < state.rows;
}

/** Every cell not currently covered by a bot, in row-major order. */
export function emptyCells(state: GameState): Point[] {
  const taken = new Set(state.bots.map((b) => b.y * state.cols + b.x));
  const cells: Point[] = [];
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      if (!taken.has(y * state.cols + x)) cells.push({ x, y });
    }
  }
  return cells;
}

/** Places a token in a uniformly random empty cell (or none if the board is full). */
export function spawnToken(state: GameState, rng: Rng = defaultRng): GameState {
  const cells = emptyCells(state);
  if (cells.length === 0) return { ...state, token: null };
  const r = Math.min(Math.max(rng(), 0), 0.999999999);
  const index = Math.floor(r * cells.length);
  return { ...state, token: cells[index] ?? cells[0] ?? null };
}

export function startGame(state: GameState, rng: Rng = defaultRng): StepResult {
  if (state.status !== 'idle') return { state, events: [] };
  return {
    state: spawnToken({ ...state, status: 'running' }, rng),
    events: ['started'],
  };
}

export function restartGame(state: GameState, rng: Rng = defaultRng): StepResult {
  return startGame(createGame(state.cols, state.rows), rng);
}

export function togglePause(state: GameState): StepResult {
  if (state.status === 'running') return { state: { ...state, status: 'paused' }, events: ['paused'] };
  if (state.status === 'paused') return { state: { ...state, status: 'running' }, events: ['resumed'] };
  return { state, events: [] };
}

/**
 * Remembers a direction change for the next tick(s). Changes are validated
 * against the *last queued* direction (or the current one if nothing is
 * queued) so that two quick presses can never produce an instant reversal.
 */
export function queueDirection(state: GameState, d: Direction): GameState {
  if (state.status !== 'running') return state;
  const reference = state.queue[state.queue.length - 1] ?? state.dir;
  if (d === reference || isOpposite(d, reference)) return state;
  if (state.queue.length >= QUEUE_MAX) return state;
  return { ...state, queue: [...state.queue, d] };
}

/** Milliseconds until the next step for the given swarm size. */
export function tickInterval(state: GameState): number {
  return Math.max(MIN_TICK_MS, BASE_TICK_MS - (state.bots.length - 1) * TICK_STEP_MS);
}

/** Advances the simulation by exactly one cell. */
export function step(state: GameState, rng: Rng = defaultRng): StepResult {
  if (state.status !== 'running') return { state, events: [] };

  const [queuedDir, ...restQueue] = state.queue;
  const dir = queuedDir ?? state.dir;
  const head = state.bots[0];
  if (!head) return { state, events: [] };

  const v = VECTORS[dir];
  const next: Point = { x: head.x + v.x, y: head.y + v.y };
  const base: GameState = { ...state, dir, queue: restQueue, tick: state.tick + 1 };

  if (!isInside(state, next)) {
    return { state: { ...base, status: 'over' }, events: ['over'] };
  }

  const eating = state.token !== null && samePoint(next, state.token);

  // The tail moves out of its cell this tick unless we grow, so it only counts
  // as an obstacle when we are eating (and therefore keeping the tail).
  const obstacles = eating ? state.bots : state.bots.slice(0, -1);
  if (obstacles.some((b) => samePoint(b, next))) {
    return { state: { ...base, status: 'over' }, events: ['over'] };
  }

  const bots = eating ? [next, ...state.bots] : [next, ...state.bots.slice(0, -1)];

  if (!eating) {
    return { state: { ...base, bots }, events: ['moved'] };
  }

  const grown: GameState = { ...base, bots, score: state.score + 1, token: null };
  if (bots.length >= cellCount(state)) {
    return { state: { ...grown, status: 'won' }, events: ['moved', 'spawned', 'won'] };
  }
  return { state: spawnToken(grown, rng), events: ['moved', 'spawned'] };
}

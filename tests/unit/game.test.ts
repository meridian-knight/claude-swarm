import { describe, expect, it } from 'vitest';
import {
  BASE_TICK_MS,
  GRID_COLS,
  GRID_ROWS,
  MIN_TICK_MS,
  QUEUE_MAX,
} from '../../src/game/config';
import {
  createGame,
  emptyCells,
  isOccupied,
  queueDirection,
  restartGame,
  spawnToken,
  startGame,
  step,
  tickInterval,
  togglePause,
} from '../../src/game/game';
import { seededRng, type Rng } from '../../src/game/rng';
import type { GameState, Point } from '../../src/game/types';

/** Always picks the first empty cell (row-major). */
const pickFirst: Rng = () => 0;
/** Always picks the last empty cell. */
const pickLast: Rng = () => 0.999999;

const FAR: Point = { x: 19, y: 19 };

function running(overrides: Partial<GameState>): GameState {
  return { ...createGame(), status: 'running', token: FAR, ...overrides };
}

function stepN(state: GameState, n: number, rng: Rng = pickFirst): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = step(s, rng).state;
  return s;
}

describe('createGame / startGame', () => {
  it('starts idle with a single bot in the centre and no token', () => {
    const g = createGame();
    expect(g.status).toBe('idle');
    expect(g.bots).toEqual([{ x: GRID_COLS / 2, y: GRID_ROWS / 2 }]);
    expect(g.token).toBeNull();
    expect(g.score).toBe(0);
    expect(g.dir).toBe('right');
    expect(g.queue).toEqual([]);
  });

  it('startGame switches to running and spawns a token on an empty cell', () => {
    const { state, events } = startGame(createGame(), seededRng(1));
    expect(state.status).toBe('running');
    expect(events).toEqual(['started']);
    expect(state.token).not.toBeNull();
    expect(isOccupied(state, state.token!)).toBe(false);
  });

  it('startGame is a no-op unless idle', () => {
    const started = startGame(createGame(), pickFirst).state;
    expect(startGame(started, pickFirst)).toEqual({ state: started, events: [] });
    const over = { ...started, status: 'over' as const };
    expect(startGame(over, pickFirst).state).toBe(over);
  });

  it('step does nothing unless running', () => {
    for (const status of ['idle', 'paused', 'over', 'won'] as const) {
      const s = running({ status });
      expect(step(s, pickFirst)).toEqual({ state: s, events: [] });
    }
  });
});

describe('movement', () => {
  it('moves the head one cell in the current direction', () => {
    const s = running({ bots: [{ x: 5, y: 5 }] });
    expect(step(s, pickFirst).state.bots).toEqual([{ x: 6, y: 5 }]);
    expect(step({ ...s, dir: 'up' }, pickFirst).state.bots).toEqual([{ x: 5, y: 4 }]);
    expect(step({ ...s, dir: 'left' }, pickFirst).state.bots).toEqual([{ x: 4, y: 5 }]);
    expect(step({ ...s, dir: 'down' }, pickFirst).state.bots).toEqual([{ x: 5, y: 6 }]);
  });

  it('followers trace the exact path of the leader through turns', () => {
    let s = running({
      bots: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ],
    });
    s = step(s, pickFirst).state;
    expect(s.bots).toEqual([
      { x: 6, y: 5 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ]);
    s = queueDirection(s, 'up');
    s = step(s, pickFirst).state;
    expect(s.bots).toEqual([
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 5 },
    ]);
    s = step(s, pickFirst).state;
    expect(s.bots).toEqual([
      { x: 6, y: 3 },
      { x: 6, y: 4 },
      { x: 6, y: 5 },
    ]);
    expect(s.tick).toBe(3);
    expect(s.dir).toBe('up');
  });

  it('emits a moved event and keeps the length on a plain step', () => {
    const s = running({ bots: [{ x: 5, y: 5 }, { x: 4, y: 5 }] });
    const r = step(s, pickFirst);
    expect(r.events).toEqual(['moved']);
    expect(r.state.bots).toHaveLength(2);
    expect(r.state.score).toBe(0);
  });
});

describe('growth and scoring', () => {
  it('eating a token adds exactly one bot and keeps the tail in place', () => {
    const s = running({
      bots: [{ x: 5, y: 5 }, { x: 4, y: 5 }],
      token: { x: 6, y: 5 },
    });
    const r = step(s, pickFirst);
    expect(r.state.bots).toEqual([
      { x: 6, y: 5 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ]);
    expect(r.state.score).toBe(1);
    expect(r.events).toEqual(['moved', 'spawned']);
  });

  it('increments the score by one per token only', () => {
    let s = running({ bots: [{ x: 0, y: 0 }], token: { x: 1, y: 0 } });
    s = step(s, () => 0.5).state;
    expect(s.score).toBe(1);
    s = { ...s, token: FAR };
    s = stepN(s, 3);
    expect(s.score).toBe(1);
    s = { ...s, token: { x: 5, y: 0 } };
    s = step(s, () => 0.5).state;
    expect(s.score).toBe(2);
    expect(s.bots).toHaveLength(3);
  });
});

describe('token placement', () => {
  it('lists empty cells in row-major order', () => {
    const s = { ...createGame(2, 2), bots: [{ x: 0, y: 0 }] };
    expect(emptyCells(s)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('maps the rng onto empty cells only', () => {
    const s = { ...createGame(3, 1), bots: [{ x: 1, y: 0 }] };
    expect(spawnToken(s, pickFirst).token).toEqual({ x: 0, y: 0 });
    expect(spawnToken(s, pickLast).token).toEqual({ x: 2, y: 0 });
  });

  it('never spawns a token on a bot or outside the grid', () => {
    const rng = seededRng(1234);
    for (let i = 0; i < 500; i++) {
      const bots: Point[] = [];
      const n = 1 + Math.floor(rng() * 40);
      for (let j = 0; j < n; j++) {
        bots.push({ x: Math.floor(rng() * GRID_COLS), y: Math.floor(rng() * GRID_ROWS) });
      }
      const s = spawnToken({ ...createGame(), bots }, rng);
      expect(s.token).not.toBeNull();
      expect(isOccupied(s, s.token!)).toBe(false);
      expect(s.token!.x).toBeGreaterThanOrEqual(0);
      expect(s.token!.y).toBeGreaterThanOrEqual(0);
      expect(s.token!.x).toBeLessThan(GRID_COLS);
      expect(s.token!.y).toBeLessThan(GRID_ROWS);
    }
  });

  it('never spawns on the swarm while a seeded swarm grows across the board', () => {
    const rng = seededRng(7);
    let s: GameState = { ...createGame(), bots: [{ x: 0, y: 10 }], status: 'running' };
    s = spawnToken(s, rng);
    for (let i = 0; i < 18; i++) {
      // Put the token directly ahead so every step grows the swarm by one.
      s = { ...s, token: { x: s.bots[0]!.x + 1, y: 10 } };
      s = step(s, rng).state;
      expect(s.status).toBe('running');
      expect(s.bots).toHaveLength(i + 2);
      expect(s.token).not.toBeNull();
      expect(isOccupied(s, s.token!)).toBe(false);
    }
  });

  it('yields no token when the board is full', () => {
    const s = { ...createGame(1, 1), bots: [{ x: 0, y: 0 }] };
    expect(spawnToken(s, pickFirst).token).toBeNull();
  });
});

describe('collisions', () => {
  it('ends the game on each wall without moving the swarm', () => {
    const cases: Array<[Point, GameState['dir']]> = [
      [{ x: GRID_COLS - 1, y: 5 }, 'right'],
      [{ x: 0, y: 5 }, 'left'],
      [{ x: 5, y: 0 }, 'up'],
      [{ x: 5, y: GRID_ROWS - 1 }, 'down'],
    ];
    for (const [head, dir] of cases) {
      const s = running({ bots: [head], dir });
      const r = step(s, pickFirst);
      expect(r.state.status).toBe('over');
      expect(r.state.bots).toEqual([head]);
      expect(r.events).toEqual(['over']);
    }
  });

  it('ends the game when the head runs into the chain', () => {
    // U-shaped swarm; head at (1,1) moving right hits body cell (2,1).
    const s = running({
      bots: [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
      dir: 'right',
    });
    const r = step(s, pickFirst);
    expect(r.state.status).toBe('over');
    expect(r.events).toEqual(['over']);
  });

  it('allows the head to enter the tail cell because the tail moves away', () => {
    const loop: Point[] = [
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const s = running({ bots: loop, dir: 'down', token: FAR });
    const r = step(s, pickFirst);
    expect(r.state.status).toBe('running');
    expect(r.state.bots).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('but the tail cell is fatal when eating, since the tail stays put', () => {
    const loop: Point[] = [
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    const s = running({ bots: loop, dir: 'down', token: { x: 1, y: 1 } });
    const r = step(s, pickFirst);
    expect(r.state.status).toBe('over');
  });
});

describe('direction queue and reversal prevention', () => {
  it('ignores the opposite of the current direction', () => {
    const s = running({ bots: [{ x: 5, y: 5 }, { x: 4, y: 5 }] });
    const q = queueDirection(s, 'left');
    expect(q.queue).toEqual([]);
    expect(step(q, pickFirst).state.bots[0]).toEqual({ x: 6, y: 5 });
  });

  it('ignores a repeat of the current direction', () => {
    expect(queueDirection(running({}), 'right').queue).toEqual([]);
  });

  it('validates rapid presses against the last queued direction', () => {
    let s = running({ bots: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }] });
    s = queueDirection(s, 'up');
    s = queueDirection(s, 'down'); // opposite of queued "up" -> dropped
    expect(s.queue).toEqual(['up']);
    s = queueDirection(s, 'left'); // fine relative to "up"
    expect(s.queue).toEqual(['up', 'left']);

    s = step(s, pickFirst).state;
    expect(s.bots[0]).toEqual({ x: 5, y: 4 });
    s = step(s, pickFirst).state;
    expect(s.bots[0]).toEqual({ x: 4, y: 4 });
    expect(s.status).toBe('running');
    expect(s.queue).toEqual([]);
  });

  it('never reverses into the neck even with up-then-left inside one tick', () => {
    // Without a queue, "up" then "left" while moving right would set dir=left
    // before the next tick and drive the head into its own neck.
    let s = running({ bots: [{ x: 5, y: 5 }, { x: 4, y: 5 }] });
    s = queueDirection(queueDirection(s, 'up'), 'left');
    s = step(s, pickFirst).state;
    expect(s.status).toBe('running');
    expect(s.bots).toEqual([{ x: 5, y: 4 }, { x: 5, y: 5 }]);
  });

  it(`keeps at most ${QUEUE_MAX} pending directions`, () => {
    let s = running({});
    s = queueDirection(s, 'up');
    s = queueDirection(s, 'left');
    s = queueDirection(s, 'down');
    expect(s.queue).toEqual(['up', 'left']);
  });

  it('ignores input unless running', () => {
    expect(queueDirection(createGame(), 'up').queue).toEqual([]);
    expect(queueDirection(running({ status: 'paused' }), 'up').queue).toEqual([]);
    expect(queueDirection(running({ status: 'over' }), 'up').queue).toEqual([]);
  });
});

describe('pause', () => {
  it('toggles between running and paused and freezes the simulation', () => {
    const s = running({ bots: [{ x: 5, y: 5 }] });
    const paused = togglePause(s);
    expect(paused.state.status).toBe('paused');
    expect(paused.events).toEqual(['paused']);
    expect(step(paused.state, pickFirst).state).toBe(paused.state);

    const resumed = togglePause(paused.state);
    expect(resumed.state.status).toBe('running');
    expect(resumed.events).toEqual(['resumed']);
    expect(step(resumed.state, pickFirst).state.bots[0]).toEqual({ x: 6, y: 5 });
  });

  it('is a no-op when idle, over or won', () => {
    for (const status of ['idle', 'over', 'won'] as const) {
      const s = running({ status });
      expect(togglePause(s)).toEqual({ state: s, events: [] });
    }
  });
});

describe('restart', () => {
  it('produces a fresh running game after a loss', () => {
    let s = running({ bots: [{ x: GRID_COLS - 1, y: 5 }, { x: GRID_COLS - 2, y: 5 }], score: 7 });
    s = step(s, pickFirst).state;
    expect(s.status).toBe('over');

    const r = restartGame(s, seededRng(3));
    expect(r.events).toEqual(['started']);
    expect(r.state.status).toBe('running');
    expect(r.state.bots).toHaveLength(1);
    expect(r.state.score).toBe(0);
    expect(r.state.tick).toBe(0);
    expect(r.state.queue).toEqual([]);
    expect(r.state.token).not.toBeNull();
    expect(r.state.cols).toBe(GRID_COLS);
  });
});

describe('winning', () => {
  it('wins when the swarm fills a 2x2 board', () => {
    let s: GameState = { ...createGame(2, 2), bots: [{ x: 0, y: 0 }], status: 'running' };
    s = spawnToken(s, pickFirst);
    expect(s.token).toEqual({ x: 1, y: 0 });

    s = step(s, pickFirst).state; // eat (1,0)
    expect(s.bots).toHaveLength(2);
    expect(s.token).toEqual({ x: 0, y: 1 });

    s = step(queueDirection(s, 'down'), pickFirst).state; // to (1,1)
    expect(s.status).toBe('running');
    s = step(queueDirection(s, 'left'), pickFirst).state; // eat (0,1)
    expect(s.bots).toHaveLength(3);
    expect(s.token).toEqual({ x: 0, y: 0 });

    const r = step(queueDirection(s, 'up'), pickFirst); // eat (0,0): full
    expect(r.state.status).toBe('won');
    expect(r.state.token).toBeNull();
    expect(r.state.bots).toHaveLength(4);
    expect(r.state.score).toBe(3);
    expect(r.events).toContain('won');
    expect(step(r.state, pickFirst).state).toBe(r.state);
  });

  it('wins on a 1x3 strip', () => {
    let s: GameState = { ...createGame(3, 1), bots: [{ x: 0, y: 0 }], status: 'running' };
    s = spawnToken(s, pickFirst);
    s = step(s, pickFirst).state;
    expect(s.status).toBe('running');
    s = step(s, pickFirst).state;
    expect(s.status).toBe('won');
    expect(s.bots).toHaveLength(3);
  });
});

describe('speed', () => {
  it('starts at the base interval and speeds up as bots join, down to a floor', () => {
    const one = createGame();
    expect(tickInterval(one)).toBe(BASE_TICK_MS);

    let previous = tickInterval(one);
    for (let n = 2; n <= 60; n++) {
      const bots = Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
      const interval = tickInterval({ ...one, bots });
      expect(interval).toBeLessThanOrEqual(previous);
      expect(interval).toBeGreaterThanOrEqual(MIN_TICK_MS);
      if (previous > MIN_TICK_MS) expect(interval).toBeLessThan(previous);
      previous = interval;
    }
    expect(previous).toBe(MIN_TICK_MS);
  });
});

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export type Status = 'idle' | 'running' | 'paused' | 'over' | 'won';

/**
 * Complete, serialisable game state. `bots[0]` is the leader (head); every
 * other bot follows the exact path of the one before it, Snake-style.
 */
export interface GameState {
  readonly cols: number;
  readonly rows: number;
  readonly bots: readonly Point[];
  readonly dir: Direction;
  readonly queue: readonly Direction[];
  readonly token: Point | null;
  readonly score: number;
  readonly status: Status;
  readonly tick: number;
}

export type GameEvent =
  | 'started'
  | 'moved'
  | 'spawned'
  | 'paused'
  | 'resumed'
  | 'over'
  | 'won';

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

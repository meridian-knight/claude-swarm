export const GRID_COLS = 20;
export const GRID_ROWS = 20;

/** Milliseconds between steps with a single bot. */
export const BASE_TICK_MS = 180;
/** Milliseconds shaved off per extra bot in the swarm. */
export const TICK_STEP_MS = 5;
/** Fastest the game ever gets. */
export const MIN_TICK_MS = 70;

/** How many not-yet-applied direction changes we remember. */
export const QUEUE_MAX = 2;

import './style.css';
import { GRID_COLS, GRID_ROWS } from './game/config';
import {
  createGame,
  queueDirection,
  restartGame,
  startGame,
  step,
  tickInterval,
  togglePause,
} from './game/game';
import { defaultRng, seededRng, type Rng } from './game/rng';
import type { Direction, GameState, Point, StepResult } from './game/types';
import { GameAudio } from './ui/audio';
import { Effects } from './ui/effects';
import { Hud } from './ui/hud';
import { bindInput } from './ui/input';
import { Renderer } from './ui/renderer';
import { loadBest, loadMuted, saveBest, saveMuted } from './ui/storage';

declare global {
  interface Window {
    __swarm?: {
      getState(): GameState;
      placeToken(p: Point): void;
      step(): void;
    };
  }
}

const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const rng: Rng = seedParam !== null && seedParam !== '' ? seededRng(Number(seedParam) || 0) : defaultRng;

const canvas = document.getElementById('board') as HTMLCanvasElement;
const screen = document.getElementById('screen') as HTMLElement;
const effectsLayer = document.getElementById('effects') as HTMLElement;
const dpad = document.querySelector<HTMLElement>('.dpad');
if (!dpad) throw new Error('Missing d-pad');

const hud = new Hud();
const renderer = new Renderer(canvas, GRID_COLS, GRID_ROWS);
const effects = new Effects(effectsLayer, canvas, GRID_COLS);
const audio = new GameAudio(loadMuted());

let state: GameState = createGame(GRID_COLS, GRID_ROWS);
let best = loadBest();
let bestAtRunStart = best;
let legFrame: 0 | 1 = 0;
let flashUntil = 0;
let accumulator = 0;
let lastFrame = 0;

function syncHud(): void {
  hud.setStats({ score: state.score, best, bots: state.bots.length });
  hud.setOverlay({ status: state.status, score: state.score, best, newBest: best > bestAtRunStart });
}

function apply(result: StepResult): void {
  state = result.state;
  for (const event of result.events) {
    switch (event) {
      case 'started':
        bestAtRunStart = best;
        accumulator = 0;
        audio.play('start');
        break;
      case 'spawned': {
        const head = state.bots[0];
        if (head) effects.spawned(head);
        flashUntil = performance.now() + 260;
        audio.play('eat');
        if (state.score > best) {
          best = state.score;
          saveBest(best);
        }
        break;
      }
      case 'paused':
        audio.play('pause');
        break;
      case 'resumed':
        accumulator = 0;
        audio.play('resume');
        break;
      case 'over':
        audio.play('over');
        break;
      case 'won':
        audio.play('won');
        break;
      case 'moved':
        break;
    }
  }
  syncHud();
}

function startOrRestart(): void {
  if (state.status === 'idle') apply(startGame(state, rng));
  else if (state.status === 'over' || state.status === 'won') apply(restartGame(state, rng));
}

bindInput(
  {
    onDirection(dir: Direction) {
      if (state.status === 'idle') apply(startGame(state, rng));
      const next = queueDirection(state, dir);
      if (next !== state) {
        state = next;
      }
    },
    onPause() {
      apply(togglePause(state));
    },
    onEnter() {
      if (state.status === 'paused') apply(togglePause(state));
      else startOrRestart();
    },
    onAction() {
      if (state.status === 'paused') apply(togglePause(state));
      else startOrRestart();
    },
    onGesture() {
      audio.unlock();
    },
  },
  { canvas, dpad, action: hud.actionButton, pause: hud.pauseButton },
);

hud.setMuted(audio.isMuted);
hud.muteButton.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.isMuted);
  saveMuted(audio.isMuted);
  hud.setMuted(audio.isMuted);
  hud.muteButton.blur();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.status === 'running') apply(togglePause(state));
});

const resize = (): void => {
  const rect = screen.getBoundingClientRect();
  renderer.resize(Math.min(rect.width, rect.height));
};
new ResizeObserver(resize).observe(screen);
resize();

function frame(now: number): void {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  if (state.status === 'running') {
    accumulator += dt;
    let interval = tickInterval(state);
    while (state.status === 'running' && accumulator >= interval) {
      accumulator -= interval;
      apply(step(state, rng));
      legFrame = legFrame === 0 ? 1 : 0;
      interval = tickInterval(state);
    }
  } else {
    accumulator = 0;
  }
  renderer.draw(state, { legFrame, time: now, flashUntil });
  window.requestAnimationFrame(frame);
}

syncHud();
window.requestAnimationFrame((t) => {
  lastFrame = t;
  frame(t);
});

if (params.has('test')) {
  window.__swarm = {
    getState: () => state,
    placeToken(p: Point) {
      state = { ...state, token: p };
    },
    step() {
      apply(step(state, rng));
    },
  };
}

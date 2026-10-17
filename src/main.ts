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
import { HelpModal } from './ui/help';
import { Hud } from './ui/hud';
import { bindInput } from './ui/input';
import { Mascot } from './ui/mascot';
import { Renderer } from './ui/renderer';
import { loadBest, loadMuted, saveBest, saveMuted } from './ui/storage';
import { VisualState } from './ui/visual';

declare global {
  interface Window {
    __swarm?: {
      getState(): GameState;
      placeToken(p: Point): void;
      step(): void;
      lastDraw(): Point;
      lastTokenDraw(): Point | null;
      tokenFrame(): 0 | 1;
      particleCount(): number;
      frameStats(): { avgMs: number; maxMs: number; samples: number };
    };
  }
}

/** How long death / win animations play before the overlay opens (visual only). */
const OVER_OVERLAY_DELAY_MS = 450;
const WON_OVERLAY_DELAY_MS = 700;

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
const visual = new VisualState();
const mascot = new Mascot(hud.mascot, () => visual.reducedMotion);

const helpRoot = document.getElementById('help') as HTMLElement;
const helpClose = document.getElementById('help-close') as HTMLButtonElement;
const helpButton = document.getElementById('help-btn') as HTMLButtonElement;
let resumeAfterHelp = false;
const help = new HelpModal(helpRoot, helpClose, helpButton, {
  onOpen() {
    audio.unlock();
    hud.suppressPause = true;
    resumeAfterHelp = state.status === 'running';
    if (resumeAfterHelp) apply(togglePause(state));
  },
  onClose() {
    hud.suppressPause = false;
    if (resumeAfterHelp && state.status === 'paused') apply(togglePause(state));
    else syncHud();
    resumeAfterHelp = false;
  },
});

let state: GameState = createGame(GRID_COLS, GRID_ROWS);
let best = loadBest();
let bestAtRunStart = best;
let accumulator = 0;
let lastFrame = 0;
const frameTimes: number[] = [];

function syncHud(delayMs = 0): void {
  hud.setStats({ score: state.score, best, bots: state.bots.length });
  hud.setOverlay({ status: state.status, score: state.score, best, newBest: best > bestAtRunStart }, delayMs);
}

function apply(result: StepResult): void {
  const prev = state;
  state = result.state;
  const now = performance.now();
  visual.observe(prev, state, result.events, now);
  let overlayDelay = 0;
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
        audio.play('resume');
        break;
      case 'over':
        overlayDelay = OVER_OVERLAY_DELAY_MS;
        audio.play('over');
        break;
      case 'won':
        overlayDelay = WON_OVERLAY_DELAY_MS;
        audio.play('won');
        break;
      case 'moved':
        break;
    }
  }
  syncHud(overlayDelay);
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
    isBlocked() {
      return help.isOpen;
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
  const inner = Math.min(screen.clientWidth, screen.clientHeight);
  renderer.resize(inner);
  mascot.fit(parseFloat(getComputedStyle(hud.titleNode).fontSize) || 20);
};
new ResizeObserver(resize).observe(screen);
resize();

function frame(now: number): void {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  frameTimes.push(dt);
  if (frameTimes.length > 120) frameTimes.shift();

  if (state.status === 'running') {
    accumulator += dt;
    let interval = tickInterval(state);
    while (state.status === 'running' && accumulator >= interval) {
      accumulator -= interval;
      apply(step(state, rng));
      interval = tickInterval(state);
    }
  } else if (state.status !== 'paused') {
    // Paused keeps its mid-step offset so bots freeze in place; other states rest on the grid.
    accumulator = 0;
  }
  const progress = state.status === 'running' || state.status === 'paused' ? accumulator / tickInterval(state) : 1;

  visual.prune(now);
  renderer.draw(state, visual, now, progress);
  if (state.status === 'idle') mascot.draw(now);
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
    lastDraw: () => renderer.lastHead,
    lastTokenDraw: () => renderer.lastToken,
    tokenFrame: () => renderer.lastTokenFrame,
    particleCount: () => visual.particles.length,
    frameStats() {
      const samples = frameTimes.length;
      const avgMs = samples ? frameTimes.reduce((a, b) => a + b, 0) / samples : 0;
      const maxMs = samples ? Math.max(...frameTimes) : 0;
      return { avgMs, maxMs, samples };
    },
  };
}

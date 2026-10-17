import type { Status } from '../game/types';
import { renderControls } from './controls';

export interface HudStats {
  score: number;
  best: number;
  bots: number;
}

export interface OverlayInfo {
  status: Status;
  score: number;
  best: number;
  newBest: boolean;
}

const OVERLAY_FADE_MS = 200;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export class Hud {
  private readonly score = el<HTMLElement>('score');
  private readonly best = el<HTMLElement>('best');
  private readonly bots = el<HTMLElement>('bots');
  private readonly overlay = el<HTMLElement>('overlay');
  private readonly title = el<HTMLElement>('overlay-title');
  private readonly text = el<HTMLElement>('overlay-text');
  private readonly keys = el<HTMLElement>('overlay-keys');
  private readonly controls = el<HTMLElement>('overlay-controls');
  readonly mascot = el<HTMLCanvasElement>('mascot');
  readonly titleNode = el<HTMLElement>('overlay-title');
  /** While the help dialog is open, the pause overlay stays hidden underneath it. */
  suppressPause = false;
  readonly actionButton = el<HTMLButtonElement>('action-btn');
  readonly pauseButton = el<HTMLButtonElement>('pause-btn');
  readonly muteButton = el<HTMLButtonElement>('mute-btn');

  private last: HudStats = { score: -1, best: -1, bots: -1 };
  private openTimer: number | null = null;
  private closeTimer: number | null = null;

  constructor() {
    renderControls(this.controls, TOUCH);
    const helpControls = document.getElementById('help-controls');
    if (helpControls) renderControls(helpControls, TOUCH);
  }

  setStats(stats: HudStats): void {
    this.update(this.score, stats.score, this.last.score);
    this.update(this.best, stats.best, this.last.best);
    this.update(this.bots, stats.bots, this.last.bots);
    this.last = { ...stats };
  }

  private update(node: HTMLElement, value: number, previous: number): void {
    if (value === previous) return;
    node.textContent = String(value);
    if (previous >= 0 && value > previous) {
      node.classList.remove('bump');
      void node.offsetWidth; // restart the animation
      node.classList.add('bump');
    }
  }

  setMuted(muted: boolean): void {
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.muteButton.textContent = muted ? '🔇' : '🔊';
  }

  /**
   * Updates body status synchronously (input and tests rely on it) and shows
   * or hides the overlay, optionally after a short delay so a death or win
   * animation can play first.
   */
  setOverlay({ status, score, best, newBest }: OverlayInfo, delayMs = 0): void {
    document.body.dataset.status = status;
    this.pauseButton.disabled = status !== 'running' && status !== 'paused';
    this.pauseButton.textContent = status === 'paused' ? '▶' : '❚❚';
    this.pauseButton.setAttribute('aria-label', status === 'paused' ? 'Resume' : 'Pause');
    this.pauseButton.dataset.deckLabel = status === 'paused' ? 'A · Resume' : 'A · Pause';

    if (this.openTimer !== null) window.clearTimeout(this.openTimer);
    this.openTimer = null;
    if (status === 'running' || (status === 'paused' && this.suppressPause)) {
      this.close();
      return;
    }
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = null;

    this.overlay.dataset.status = status;
    this.mascot.hidden = status !== 'idle';
    this.controls.hidden = status !== 'idle';
    this.keys.hidden = status === 'idle';
    switch (status) {
      case 'idle':
        this.title.textContent = 'Claude Swarm';
        this.text.textContent = 'Collect tokens to grow your chain. Avoid walls and yourself.';
        this.keys.textContent = '';
        this.actionButton.textContent = 'Start';
        break;
      case 'paused':
        this.title.textContent = 'Paused';
        this.text.textContent = 'The swarm is holding position.';
        this.keys.textContent = TOUCH ? 'Tap Resume to continue' : 'Space or Enter to resume';
        this.actionButton.textContent = 'Resume';
        break;
      case 'over':
        this.title.textContent = 'Game over';
        this.text.textContent = newBest ? `New best: ${score} tokens!` : `Score ${score} · Best ${best}`;
        this.keys.textContent = TOUCH ? 'Tap Restart to try again' : 'Enter to restart';
        this.actionButton.textContent = 'Restart';
        break;
      case 'won':
        this.title.textContent = 'Swarm complete!';
        this.text.textContent = `Every cell is a Claude. Score ${score}.`;
        this.keys.textContent = TOUCH ? 'Tap to play again' : 'Enter to play again';
        this.actionButton.textContent = 'Play again';
        break;
    }

    const delay = prefersReducedMotion() ? 0 : delayMs;
    if (delay > 0) {
      this.openTimer = window.setTimeout(() => this.open(), delay);
    } else {
      this.open();
    }
  }

  private open(): void {
    this.overlay.hidden = false;
    void this.overlay.offsetWidth;
    this.overlay.classList.add('is-open');
  }

  private close(): void {
    this.overlay.classList.remove('is-open');
    if (this.overlay.hidden || this.closeTimer !== null) return;
    if (prefersReducedMotion()) {
      this.overlay.hidden = true;
      return;
    }
    this.closeTimer = window.setTimeout(() => {
      this.overlay.hidden = true;
      this.closeTimer = null;
    }, OVERLAY_FADE_MS);
  }
}

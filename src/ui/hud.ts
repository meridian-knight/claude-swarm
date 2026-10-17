import type { Status } from '../game/types';

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

const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export class Hud {
  private readonly score = el<HTMLElement>('score');
  private readonly best = el<HTMLElement>('best');
  private readonly bots = el<HTMLElement>('bots');
  private readonly overlay = el<HTMLElement>('overlay');
  private readonly title = el<HTMLElement>('overlay-title');
  private readonly text = el<HTMLElement>('overlay-text');
  private readonly keys = el<HTMLElement>('overlay-keys');
  readonly actionButton = el<HTMLButtonElement>('action-btn');
  readonly pauseButton = el<HTMLButtonElement>('pause-btn');
  readonly muteButton = el<HTMLButtonElement>('mute-btn');

  setStats({ score, best, bots }: HudStats): void {
    this.score.textContent = String(score);
    this.best.textContent = String(best);
    this.bots.textContent = String(bots);
  }

  setMuted(muted: boolean): void {
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.muteButton.textContent = muted ? '🔇' : '🔊';
  }

  setOverlay({ status, score, best, newBest }: OverlayInfo): void {
    document.body.dataset.status = status;
    this.pauseButton.disabled = status !== 'running' && status !== 'paused';
    this.pauseButton.textContent = status === 'paused' ? '▶' : '❚❚';
    this.pauseButton.setAttribute('aria-label', status === 'paused' ? 'Resume' : 'Pause');

    if (status === 'running') {
      this.overlay.hidden = true;
      return;
    }
    this.overlay.hidden = false;
    this.overlay.dataset.status = status;

    switch (status) {
      case 'idle':
        this.title.textContent = 'Claude Swarm';
        this.text.textContent = 'Eat tokens to spawn agents. Every token adds a bot to your swarm. Don’t hit the walls or your own chain.';
        this.keys.textContent = TOUCH ? 'Tap Start, then steer with the D-pad or swipe' : 'Arrows / WASD move · Space pause · Enter start';
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
        this.text.textContent = newBest
          ? `New best: ${score} tokens!`
          : `Score ${score} · Best ${best}`;
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
  }
}

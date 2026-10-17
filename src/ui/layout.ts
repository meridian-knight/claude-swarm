/**
 * Moves the pause, help and sound buttons between the HUD (desktop) and the
 * Game Boy style deck (touch layouts). The same elements, ids and handlers
 * are used in both places; only their container changes.
 */
export const TOUCH_LAYOUT_QUERY = '(pointer: coarse), (max-width: 700px)';

export interface LayoutElements {
  hudButtons: HTMLElement;
  deckAb: HTMLElement;
  deckPills: HTMLElement;
  pause: HTMLButtonElement;
  help: HTMLButtonElement;
  mute: HTMLButtonElement;
}

export function bindLayout(els: LayoutElements, onChange?: (touch: boolean) => void): () => boolean {
  const mq = window.matchMedia(TOUCH_LAYOUT_QUERY);
  const apply = (): void => {
    if (mq.matches) {
      els.deckAb.append(els.mute, els.pause, els.help);
      els.deckPills.hidden = true;
      document.body.dataset.layout = 'touch';
    } else {
      els.hudButtons.append(els.help, els.pause, els.mute);
      els.deckPills.hidden = true;
      document.body.dataset.layout = 'desktop';
    }
    onChange?.(mq.matches);
  };
  mq.addEventListener('change', apply);
  apply();
  return () => mq.matches;
}

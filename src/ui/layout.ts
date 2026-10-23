/**
 * Moves the pause, help and sound buttons between the HUD (desktop) and the
 * left-hand utility stack of the touch deck. The same elements, ids and
 * handlers are used in both places; only their container changes.
 */
export const TOUCH_LAYOUT_QUERY = '(pointer: coarse), (max-width: 700px)';
/** The one touch-layout query every module reads, so layout, copy and legends agree. */
export const touchLayout = window.matchMedia(TOUCH_LAYOUT_QUERY);

export interface LayoutElements {
  hudButtons: HTMLElement;
  deckLeft: HTMLElement;
  pause: HTMLButtonElement;
  help: HTMLButtonElement;
  mute: HTMLButtonElement;
}

export function bindLayout(els: LayoutElements): void {
  const apply = (): void => {
    if (touchLayout.matches) {
      els.deckLeft.append(els.pause, els.help, els.mute);
      document.body.dataset.layout = 'touch';
    } else {
      els.hudButtons.append(els.help, els.pause, els.mute);
      document.body.dataset.layout = 'desktop';
    }
    // Whitespace text nodes keep the emptied bar from matching :empty, so hide it explicitly.
    els.hudButtons.hidden = touchLayout.matches;
  };
  touchLayout.addEventListener('change', apply);
  apply();
}

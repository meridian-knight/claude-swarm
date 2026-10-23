/**
 * Accessible "How to play" dialog. Owns focus management and the Escape key;
 * the caller decides what pausing and resuming mean.
 */
const FADE_MS = 200;

export interface HelpHooks {
  onOpen(): void;
  onClose(): void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class HelpModal {
  private opened = false;
  private returnFocus: HTMLElement | null = null;
  private hideTimer: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly closeButton: HTMLButtonElement,
    private readonly opener: HTMLButtonElement,
    private readonly hooks: HelpHooks,
  ) {
    // detail is 0 for keyboard activation, so a pointer close does not restore focus.
    opener.addEventListener('click', (e) => this.toggle(e.detail > 0));
    closeButton.addEventListener('click', (e) => this.close(e.detail > 0));
    root.addEventListener('click', (e) => {
      if (e.target === root) this.close(e.detail > 0); // click on the backdrop
    });
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.opened) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.close();
          return;
        }
        if (e.key === 'Tab') this.trapTab(e);
      },
      { capture: true },
    );
  }

  get isOpen(): boolean {
    return this.opened;
  }

  toggle(viaPointer = false): void {
    if (this.opened) this.close(viaPointer);
    else this.open();
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : this.opener;
    document.body.dataset.help = 'open';
    this.opener.setAttribute('aria-expanded', 'true');
    this.root.hidden = false;
    void this.root.offsetWidth;
    this.root.classList.add('is-open');
    this.hooks.onOpen();
    this.closeButton.focus({ preventScroll: true });
    this.root.querySelector(".modal-panel")?.scrollTo({ top: 0 });
  }

  /**
   * Keyboard closes (Escape, Enter on Close) return focus to where it was so
   * the user can carry on; a pointer close leaves nothing focused, otherwise
   * the help button would keep focus and Space or Enter would reopen it.
   */
  close(viaPointer = false): void {
    if (!this.opened) return;
    this.opened = false;
    delete document.body.dataset.help;
    this.opener.setAttribute('aria-expanded', 'false');
    this.root.classList.remove('is-open');
    const hide = (): void => {
      this.root.hidden = true;
      this.hideTimer = null;
    };
    if (prefersReducedMotion()) hide();
    else this.hideTimer = window.setTimeout(hide, FADE_MS);
    this.hooks.onClose();
    if (viaPointer) (document.activeElement as HTMLElement | null)?.blur();
    else (this.returnFocus ?? this.opener).focus();
    this.returnFocus = null;
  }

  private trapTab(e: KeyboardEvent): void {
    const items = Array.from(this.root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !this.root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !this.root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
}

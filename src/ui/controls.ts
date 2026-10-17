/** Markup for the visual controls legend, shared by the start screen and the help modal. */

function cluster(up: string, left: string, down: string, right: string, label: string): string {
  return `<span class="keys-cluster" role="img" aria-label="${label}">
    <kbd class="key k-up">${up}</kbd>
    <kbd class="key k-left">${left}</kbd>
    <kbd class="key k-down">${down}</kbd>
    <kbd class="key k-right">${right}</kbd>
  </span>`;
}

export function keyboardControlsMarkup(): string {
  return `
    <div class="control-group">
      <span class="keys-row">
        ${cluster('▲', '◀', '▼', '▶', 'Arrow keys')}
        ${cluster('W', 'A', 'S', 'D', 'W A S D keys')}
      </span>
      <span class="control-label">Move</span>
    </div>
    <div class="control-group">
      <kbd class="key key-wide">Space</kbd>
      <span class="control-label">Pause</span>
    </div>
    <div class="control-group">
      <kbd class="key key-wide">Enter</kbd>
      <span class="control-label">Start</span>
    </div>`;
}

export function touchControlsMarkup(): string {
  return `
    <div class="control-group">
      <span class="mini-dpad" role="img" aria-label="Direction pad">
        <i class="u"></i><i class="l"></i><i class="c"></i><i class="r"></i><i class="d"></i>
      </span>
      <span class="control-label">D-pad or swipe</span>
    </div>
    <div class="control-group">
      <span class="key">❚❚</span>
      <span class="control-label">Pause</span>
    </div>
    <div class="control-group">
      <span class="key key-wide">Start</span>
      <span class="control-label">Tap to begin</span>
    </div>`;
}

export function renderControls(target: HTMLElement, touch: boolean): void {
  target.innerHTML = touch ? touchControlsMarkup() : keyboardControlsMarkup();
}

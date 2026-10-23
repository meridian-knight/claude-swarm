import { expect, test as base, type Page } from '@playwright/test';
import { decodePng, gridLines, pitches } from './png';

interface Point {
  x: number;
  y: number;
}
interface SwarmState {
  cols: number;
  rows: number;
  bots: readonly Point[];
  dir: 'up' | 'down' | 'left' | 'right';
  queue: readonly string[];
  status: 'idle' | 'running' | 'paused' | 'over' | 'won';
  score: number;
  tick: number;
  token: Point | null;
}
type SwarmWindow = Window & {
  __swarm: { getState(): SwarmState; placeToken(p: Point): void };
};

const VECTORS: Record<SwarmState['dir'], Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Every test collects console errors and uncaught exceptions and fails if any occurred. */
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page, baseURL }, use) => {
      const errors: string[] = [];
      const allowedHost = new URL(baseURL ?? 'http://127.0.0.1:4173').host;
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('request', (r) => {
        const url = new URL(r.url());
        if (url.protocol.startsWith('http') && url.host !== allowedHost) {
          errors.push(`external request: ${r.url()}`);
        }
      });
      page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
      });
      await use(errors);
      expect(errors, 'browser console must stay clean and no external requests').toEqual([]);
    },
    { auto: true },
  ],
});

/** Dispatches a touch pointerdown straight at a D-pad arm, bypassing hit-testing (tests the input guard). */
const pokeArm = (page: Page, dir: string): Promise<void> =>
  page.evaluate((d) => {
    const btn = document.querySelector(`[data-dir="${d}"]`) as HTMLElement;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true }));
  }, dir);

const getState = (page: Page): Promise<SwarmState> =>
  page.evaluate(() => (window as unknown as SwarmWindow).__swarm.getState());

const placeToken = (page: Page, p: Point): Promise<void> =>
  page.evaluate((pt) => (window as unknown as SwarmWindow).__swarm.placeToken(pt), p);

/** Pauses, drops a token directly in front of the head, then resumes. */
async function placeTokenAhead(page: Page, resume: () => Promise<void>, pause: () => Promise<void>): Promise<void> {
  await pause();
  await expect.poll(async () => (await getState(page)).status).toBe('paused');
  const s = await getState(page);
  const head = s.bots[0]!;
  const v = VECTORS[s.dir];
  await placeToken(page, { x: head.x + v.x, y: head.y + v.y });
  await resume();
  await expect.poll(async () => (await getState(page)).status).toBe('running');
}

test.beforeEach(async ({ page }) => {
  // Relative so the same tests run from a sub-path deployment.
  await page.goto('./?test&seed=42');
});

test('shows the start screen, instructions, HUD and fan-game label', async ({ page, isMobile }) => {
  await expect(page.locator('body')).toHaveAttribute('data-status', 'idle');
  const overlay = page.locator('#overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('h2')).toHaveText('Claude Swarm');
  const vp = page.viewportSize()!;
  if (isMobile && vp.width > vp.height && vp.height < 520) {
    // Short landscape: the legend lives in the help dialog only.
    await expect(overlay.locator('#overlay-controls')).toBeHidden();
    await expect(page.locator('#help-controls')).toContainText('Use the D-pad or swipe to move.');
  } else if (isMobile) {
    // Touch start screen: no legend, one hint line; the full legend lives in the help dialog.
    await expect(overlay.locator('#overlay-controls')).toBeHidden();
    await expect(overlay.locator('#overlay-hint')).toHaveText('Use the D-pad or swipe to move.');
    await expect(page.locator('#help-controls')).toContainText('Use the D-pad or swipe to move.');
    await expect(page.locator('#help-controls .control-group')).toHaveCount(1);
    await expect(page.locator('#help-controls .key-round')).toHaveCount(0);
    await expect(page.locator('#help-controls')).not.toContainText(/pause|help|sound/i);
  } else {
    await expect(overlay.locator('.keys-cluster')).toHaveCount(2);
    await expect(overlay.locator('.key')).toHaveCount(10);
    await expect(overlay.locator('#overlay-controls')).toContainText('Space');
    await expect(overlay.locator('#overlay-controls')).toContainText('Enter');
  }
  await expect(overlay.locator('#overlay-text')).toHaveText('Consume tokens. Spawn agents. Grow your swarm.');
  await expect(overlay.locator('#overlay-keys')).toHaveText('Avoid the walls and your own swarm.');
  await expect(page.locator('#help .rules')).toContainText('Every token spawns an agent into your swarm.');
  await expect(page.locator('.scoreboard')).toContainText('Agents');
  const hudMascot = (await page.locator('#hud-mascot').boundingBox())!;
  expect(hudMascot.height).toBeLessThanOrEqual(28);
  expect(hudMascot.width).toBeGreaterThanOrEqual(20);
  if (!(isMobile && vp.width > vp.height && vp.height < 520)) await expect(page.locator('#mascot')).toBeVisible();
  await expect(page.locator('#action-btn')).toHaveText('Start');
  await expect(page.locator('.foot')).toContainText('A FAN GAME BUILT BY CYBER SQUAD ZERO + CLAUDE.');
  await expect(page.getByText('Not affiliated with or endorsed by Anthropic.')).toBeVisible();
  await expect(page.locator('.foot')).not.toContainText(/arrows|wasd|space|enter/i);
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#bots')).toHaveText('1');
  await expect(page.locator('#board')).toBeVisible();
});

test.describe('keyboard play', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'keyboard flow runs on the desktop project');

  test('Enter starts the game and the swarm moves', async ({ page }) => {
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#overlay')).toBeHidden();
    const before = (await getState(page)).bots[0]!;
    await expect.poll(async () => (await getState(page)).bots[0]!.x).toBeGreaterThan(before.x);
  });

  test('arrow keys steer and an instant reversal is ignored', async ({ page }) => {
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowLeft'); // opposite of the initial "right": must be dropped
    await expect.poll(async () => (await getState(page)).tick).toBeGreaterThan(1);
    expect((await getState(page)).status).toBe('running');
    expect((await getState(page)).dir).toBe('right');

    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await getState(page)).dir).toBe('up');
    await page.keyboard.press('KeyA'); // WASD left
    await expect.poll(async () => (await getState(page)).dir).toBe('left');
    expect((await getState(page)).status).toBe('running');
  });

  test('collecting a token spawns an agent, scores and shows the effect', async ({ page }) => {
    await page.keyboard.press('Enter');
    const effect = page.locator('[data-effect="spawned"]');
    const sawEffect = effect.first().waitFor({ state: 'visible', timeout: 5_000 });
    await placeTokenAhead(
      page,
      () => page.keyboard.press('Space'),
      () => page.keyboard.press('Space'),
    );
    await expect.poll(async () => (await getState(page)).bots.length).toBe(2);
    await sawEffect;
    await expect(effect.first()).toHaveText('Agent spawned!');
    await expect(page.locator('#score')).toHaveText('1');
    await expect(page.locator('#bots')).toHaveText('2');
    const s = await getState(page);
    expect(s.score).toBe(1);
    expect(s.token).not.toBeNull();
    expect(s.bots.some((b) => b.x === s.token!.x && b.y === s.token!.y)).toBe(false);
  });

  test('Space pauses and resumes', async ({ page }) => {
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await getState(page)).tick).toBeGreaterThan(0);
    await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    await expect(page.locator('#overlay h2')).toHaveText('Paused');
    const frozen = await getState(page);
    await page.waitForTimeout(500);
    const still = await getState(page);
    expect(still.tick).toBe(frozen.tick);
    expect(still.bots).toEqual(frozen.bots);

    await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#overlay')).toBeHidden();
    await expect.poll(async () => (await getState(page)).tick).toBeGreaterThan(frozen.tick);
  });

  test('hitting a wall ends the game, records the best score and Enter restarts', async ({ page }) => {
    await page.keyboard.press('Enter');
    await placeTokenAhead(
      page,
      () => page.keyboard.press('Space'),
      () => page.keyboard.press('Space'),
    );
    await expect.poll(async () => (await getState(page)).score).toBeGreaterThanOrEqual(1);

    // Keep heading right until the wall.
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'over');
    await expect(page.locator('#overlay h2')).toHaveText('Game over');
    const finalScore = (await getState(page)).score;
    expect(finalScore).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#best')).toHaveText(String(finalScore));
    const stored = await page.evaluate(() => window.localStorage.getItem('claude-swarm:best'));
    expect(stored).toBe(String(finalScore));

    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#score')).toHaveText('0');
    await expect(page.locator('#bots')).toHaveText('1');
    await expect(page.locator('#best')).toHaveText(String(finalScore));
    const fresh = await getState(page);
    expect(fresh.bots).toHaveLength(1);
    expect(fresh.token).not.toBeNull();

    // Best survives a reload.
    await page.reload();
    await expect(page.locator('#best')).toHaveText(String(finalScore));
  });

  test('d-pad is hidden on a fine-pointer desktop', async ({ page }) => {
    await expect(page.locator('.dpad')).toBeHidden();
  });
});

test('mute toggle persists across reloads', async ({ page }) => {
  const mute = page.locator('#mute-btn');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
});

test.describe('touch play', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch flow runs on the mobile project');

  test('board and controls fit the viewport without horizontal scrolling', async ({ page, viewport }) => {
    const vw = viewport!.width;
    const vh = viewport!.height;
    const board = await page.locator('#board').boundingBox();
    expect(board).not.toBeNull();
    expect(board!.x).toBeGreaterThanOrEqual(0);
    expect(board!.y).toBeGreaterThanOrEqual(0);
    expect(board!.x + board!.width).toBeLessThanOrEqual(vw + 0.5);
    expect(board!.y + board!.height).toBeLessThanOrEqual(vh + 0.5);
    if (vw > vh) expect(board!.height).toBeGreaterThan(vh * 0.55);
    else expect(board!.width).toBeGreaterThan(vw * 0.7);

    await expect(page.locator('.dpad'), 'D-pad visible on the start screen').toBeVisible();
    await expect(page.locator('#help-btn'), 'help reachable on the start screen').toBeVisible();
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    const dpad = page.locator('.dpad');
    await expect(dpad).toBeVisible();
    const pad = await dpad.boundingBox();
    expect(pad!.y + pad!.height).toBeLessThanOrEqual(vh + 0.5);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('on-screen buttons start, steer, pause and resume', async ({ page }) => {
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');

    await page.locator('[data-dir="up"]').tap();
    await expect.poll(async () => (await getState(page)).dir).toBe('up');
    await page.locator('[data-dir="left"]').tap();
    await expect.poll(async () => (await getState(page)).dir).toBe('left');
    expect((await getState(page)).status).toBe('running');

    await page.locator('#pause-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    await expect(page.locator('#action-btn')).toHaveText('Resume');
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
  });

  test('collecting a token on touch spawns an agent', async ({ page }) => {
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await placeTokenAhead(
      page,
      () => page.locator('#action-btn').tap(),
      () => page.locator('#pause-btn').tap(),
    );
    await expect.poll(async () => (await getState(page)).bots.length).toBe(2);
    await expect(page.locator('#bots')).toHaveText('2');
  });
});

test.describe('visual polish safety', () => {
  test('the drawn head never leaves the grid while interpolating', async ({ page }) => {
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    const deadline = Date.now() + 2500;
    let samples = 0;
    while (Date.now() < deadline) {
      const { draw, state } = await page.evaluate(() => {
        const w = window as unknown as SwarmWindow & { __swarm: { lastDraw(): Point } };
        return { draw: w.__swarm.lastDraw(), state: w.__swarm.getState() };
      });
      if (state.status !== 'running') {
        // After death the head may bump up to 0.35 of a cell toward the wall, never further.
        expect(draw.x).toBeGreaterThanOrEqual(-0.4);
        expect(draw.x).toBeLessThanOrEqual(state.cols - 1 + 0.4);
        break;
      }
      expect(draw.x).toBeGreaterThanOrEqual(-0.01);
      expect(draw.y).toBeGreaterThanOrEqual(-0.01);
      expect(draw.x).toBeLessThanOrEqual(state.cols - 1 + 0.01);
      expect(draw.y).toBeLessThanOrEqual(state.rows - 1 + 0.01);
      samples++;
      await page.waitForTimeout(40);
    }
    expect(samples).toBeGreaterThan(10);
  });

  test('game over overlay opens within a second and Enter restarts during the death animation', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard flow');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    const overAt = Date.now();
    await expect(page.locator('#overlay')).toBeVisible({ timeout: 1_000 });
    expect(Date.now() - overAt).toBeLessThan(1_000);

    // Die again, then restart immediately while the death sequence is still playing.
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#overlay')).toBeHidden();
    expect((await getState(page)).bots).toHaveLength(1);
  });

  test('reduced motion: play, collect, pause and die with no transitions or errors', async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const pause = isMobile ? () => page.locator('#pause-btn').tap() : () => page.keyboard.press('Space');
    const resume = isMobile ? () => page.locator('#action-btn').tap() : () => page.keyboard.press('Space');
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('#overlay')).toBeHidden();

    await placeTokenAhead(page, resume, pause);
    await expect.poll(async () => (await getState(page)).bots.length).toBe(2);
    await expect(page.locator('#bots')).toHaveText('2');

    await pause();
    await expect(page.locator('#overlay')).toBeVisible();
    await expect(page.locator('#overlay h2')).toHaveText('Paused');
    await resume();
    await expect(page.locator('#overlay')).toBeHidden();

    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    await expect(page.locator('#overlay')).toBeVisible({ timeout: 500 });
  });

  test('frame times stay reasonable during play', async ({ page }, testInfo) => {
    await page.locator('#action-btn').click();
    await page.waitForTimeout(2_000);
    const stats = await page.evaluate(() =>
      (window as unknown as { __swarm: { frameStats(): { avgMs: number; maxMs: number; samples: number } } }).__swarm.frameStats(),
    );
    testInfo.annotations.push({ type: 'frame-stats', description: JSON.stringify(stats) });
    expect(stats.samples).toBeGreaterThan(30);
    expect(Number.isFinite(stats.avgMs)).toBe(true);
    // Soft budget: headless machines vary, so this only catches a real stall.
    expect(stats.avgMs).toBeLessThan(60);
  });
});

test.describe('instructions and mascot', () => {
  const footerVisible = async (page: Page): Promise<void> => {
    await expect(page.locator('.foot')).toContainText('A FAN GAME BUILT BY CYBER SQUAD ZERO + CLAUDE.');
    await expect(page.getByText('Not affiliated with or endorsed by Anthropic.')).toBeVisible();
  };

  test('footer credit stays visible in idle, running and game over', async ({ page }) => {
    await footerVisible(page);
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await footerVisible(page);
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    await footerVisible(page);
  });

  test('help opened while running pauses, blocks input, and resumes on close', async ({ page, isMobile }) => {
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect.poll(async () => (await getState(page)).tick).toBeGreaterThan(0);

    await page.locator('#help-btn').click();
    await expect(page.locator('#help')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    await expect(page.locator('body')).toHaveAttribute('data-help', 'open');
    await expect(page.locator('#help-close')).toBeFocused();
    await expect(page.locator('#overlay')).toBeHidden(); // no pause panel under the dialog

    const frozen = await getState(page);
    if (isMobile) await pokeArm(page, 'up');
    else await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(400);
    const still = await getState(page);
    expect(still.tick).toBe(frozen.tick);
    expect(still.dir).toBe('right');
    expect(still.queue).toEqual([]);

    if (isMobile) await page.locator('#help-close').tap();
    else await page.keyboard.press('Escape');
    await expect(page.locator('#help')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect(page.locator('body')).not.toHaveAttribute('data-help', 'open');
    if (!isMobile) await expect(page.locator('#help-btn')).toBeFocused();
    await expect.poll(async () => (await getState(page)).tick).toBeGreaterThan(frozen.tick);
  });

  test('help opened while paused or idle leaves that state alone', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard flow');
    await page.locator('#help-btn').click();
    await expect(page.locator('#help')).toBeVisible();
    await page.locator('#help-close').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'idle');
    await expect(page.locator('#overlay')).toBeVisible();

    // Closing returned focus to the help button, where Enter/Space would reopen it.
    await page.locator('#help-btn').blur();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    await page.locator('#help-btn').click();
    await expect(page.locator('#help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#help')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    await expect(page.locator('#overlay h2')).toHaveText('Paused');
  });

  test('tab focus stays inside the help dialog', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), 'keyboard flow');
    await page.locator('#help-btn').click();
    await expect(page.locator('#help-close')).toBeFocused();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => document.getElementById('help')!.contains(document.activeElement));
      expect(inside).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.getElementById('help')!.contains(document.activeElement))).toBe(true);
  });

  test('help dialog and start screen fit the viewport', async ({ page, viewport, hasTouch }) => {
    const vw = viewport!.width;
    const vh = viewport!.height;
    const shortLandscape = vh < 520 && vw > vh;
    const required = shortLandscape
      ? ['#overlay-title', '#action-btn']
      : hasTouch
        ? ['#mascot', '#overlay-title', '#overlay-hint', '#action-btn']
        : ['#mascot', '#overlay-title', '#overlay-controls', '#action-btn'];
    for (const sel of required) {
      const box = await page.locator(sel).boundingBox();
      expect(box, sel).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 0.5);
    }
    const board = await page.locator('#board').boundingBox();
    const btn = await page.locator('#action-btn').boundingBox();
    expect(btn!.y + btn!.height).toBeLessThanOrEqual(board!.y + board!.height + 0.5);

    await page.locator('#help-btn').click();
    await expect(page.locator('#help')).toBeVisible();
    const panel = await page.locator('.modal-panel').boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(vh + 0.5);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(vw + 0.5);
    await expect(page.locator('#help-close')).toBeVisible();
    if (hasTouch) {
      await expect(page.locator('#help-controls .mini-dpad')).toBeVisible();
      const legend = (await page.locator('#help-controls').boundingBox())!;
      expect(legend.height, 'compact single D-pad legend').toBeLessThanOrEqual(90);
      const innerScroll = await page.locator('.modal-panel').evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(innerScroll, 'help panel needs no inner scroll').toBeLessThanOrEqual(0);
      await page.waitForTimeout(250); // let the panel's open transition finish before measuring
      const closeBox = (await page.locator('#help-close').boundingBox())!;
      expect(closeBox.height).toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('mascot animates and reacts to hover or tap', async ({ page, isMobile }) => {
    const mascot = page.locator('#mascot');
    await expect(mascot).toBeVisible();
    const frame = () => mascot.getAttribute('data-frame');
    const before = await frame();
    expect(before).not.toBeNull();
    if (isMobile) {
      await mascot.tap();
    } else {
      await mascot.hover();
    }
    await expect.poll(frame, { timeout: 1_000 }).not.toBe(before);
    // Hop shows the "together" leg frame or a lift while airborne.
    await expect.poll(frame, { timeout: 1_000 }).toMatch(/:2:|:[1-3]:1$|:[1-3]:0\.85$/);
    const size = await mascot.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(isMobile ? 60 : 72);
    await page.locator('#action-btn').click();
    await expect(mascot).toBeHidden();
  });

  test('reduced motion: mascot is static until tapped and dialogs show instantly', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const mascot = page.locator('#mascot');
    await expect(mascot).toBeVisible();
    const a = await mascot.getAttribute('data-frame');
    await page.waitForTimeout(1_000);
    expect(await mascot.getAttribute('data-frame')).toBe(a);
    expect(a).toBe('centre:open:0:0:1');
    await page.locator('#help-btn').click();
    await expect(page.locator('#help')).toBeVisible();
    await page.locator('#help-close').click();
    await expect(page.locator('#help')).toBeHidden();
  });
});

test.describe('chip tokens', () => {
  type ChipWindow = Window & {
    __swarm: {
      getState(): SwarmState;
      lastTokenDraw(): Point | null;
      tokenFrame(): 0 | 1;
      particleCount(): number;
    };
  };
  const chip = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as ChipWindow;
      return { drawn: w.__swarm.lastTokenDraw(), token: w.__swarm.getState().token, frame: w.__swarm.tokenFrame(), particles: w.__swarm.particleCount() };
    });

  test('the chip is drawn exactly on the token cell and pulses', async ({ page }) => {
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const c = await chip(page);
      expect(c.drawn).toEqual(c.token);
      seen.add(c.frame);
      await page.waitForTimeout(120);
    }
    expect(seen.size).toBe(2);
  });

  test('collecting a chip bursts briefly and still spawns an agent', async ({ page, isMobile }) => {
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    const pause = isMobile ? () => page.locator('#pause-btn').tap() : () => page.keyboard.press('Space');
    const resume = isMobile ? () => page.locator('#action-btn').tap() : () => page.keyboard.press('Space');
    await placeTokenAhead(page, resume, pause);
    await expect.poll(async () => (await chip(page)).particles, { timeout: 2_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await getState(page)).bots.length).toBe(2);
    await expect(page.locator('[data-effect="spawned"]').first()).toBeVisible();
    await expect.poll(async () => (await chip(page)).particles, { timeout: 1_000 }).toBe(0);
    const after = await chip(page);
    expect(after.token).not.toBeNull();
    expect(after.drawn).toEqual(after.token);
  });

  test('reduced motion: chip stays on frame 0 and collection emits no particles', async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    for (let i = 0; i < 8; i++) {
      expect((await chip(page)).frame).toBe(0);
      await page.waitForTimeout(130);
    }
    const pause = isMobile ? () => page.locator('#pause-btn').tap() : () => page.keyboard.press('Space');
    const resume = isMobile ? () => page.locator('#action-btn').tap() : () => page.keyboard.press('Space');
    await placeTokenAhead(page, resume, pause);
    await expect.poll(async () => (await getState(page)).bots.length).toBe(2);
    expect((await chip(page)).particles).toBe(0);
  });
});

test.describe('mobile readiness', () => {
  type ReadyWindow = Window & {
    __swarm: {
      getState(): SwarmState;
      setChain(n: number): void;
      frameStats(): { avgMs: number; maxMs: number; samples: number };
    };
  };
  const center = async (page: Page, sel: string) => {
    const b = await page.locator(sel).boundingBox();
    if (!b) throw new Error(`no box for ${sel}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  test('layout fits the viewport with large touch targets', async ({ page, viewport, hasTouch }) => {
    const vw = viewport!.width;
    const vh = viewport!.height;
    const doc = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      cw: document.documentElement.clientWidth,
      ch: document.documentElement.clientHeight,
      dpr: window.devicePixelRatio,
    }));
    expect(doc.sw, 'no horizontal scroll').toBeLessThanOrEqual(doc.cw);
    if (!(hasTouch && vh < 600 && vw < vh)) expect(doc.sh, 'no vertical scroll').toBeLessThanOrEqual(doc.ch + 1);

    const board = (await page.locator('#board').boundingBox())!;
    if (vw > vh) expect(board.height).toBeGreaterThanOrEqual(vh * 0.6);
    // Whole device pixels per cell can trim up to 20 device px off the 288 px minimum board.
    else if (hasTouch && vw <= 430) expect(board.width).toBeGreaterThanOrEqual(vw * 0.74);

    const canvas = await page.evaluate(() => {
      const c = document.getElementById('board') as HTMLCanvasElement;
      return { w: c.width, css: c.getBoundingClientRect().width };
    });
    expect(canvas.w % 20, 'whole device pixels per cell').toBe(0);
    expect(Math.abs(canvas.css * doc.dpr - canvas.w), 'canvas maps 1:1 to device pixels').toBeLessThan(0.05);

    if (hasTouch) {
      await expect(page.locator('body')).toHaveAttribute('data-layout', 'touch');
      // Start screen: whole handheld visible; D-pad present but inert; utilities reachable; no keyboard legend; hint shown.
      await expect(page.locator('.dpad')).toBeVisible();
      await expect(page.locator('.dpad')).toHaveAttribute('aria-disabled', 'true');
      for (const sel of ['#pause-btn', '#help-btn', '#mute-btn']) await expect(page.locator(sel)).toBeVisible();
      await expect(page.locator('#overlay-hint')).toHaveText('Use the D-pad or swipe to move.');
      const idleGeometry = await page.evaluate(() => ['.dpad', '.deck-left', '#board', '.hud', '.foot'].map((s) => JSON.stringify(document.querySelector(s)!.getBoundingClientRect())));
      await page.locator('[data-dir="up"]').tap({ force: true }); // aria-disabled, so skip Playwright's enabled check
      await page.waitForTimeout(250);
      await expect(page.locator('body'), 'D-pad tap does not start a game').toHaveAttribute('data-status', 'idle');
      const shortScreen = vh < 600 && vw < vh;
      if (shortScreen) expect(doc.sh, 'short screens scroll instead of clipping').toBeGreaterThan(doc.ch);
      // Frame content never goes below 288px; whole device pixels per cell can trim the canvas to 280px.
      if (vw < vh) expect(board.height, 'portrait board never shrinks below 280px').toBeGreaterThanOrEqual(279);
      await expect(page.locator('#overlay-controls')).toBeHidden();
      if (!(vw > vh)) await expect(page.locator('#overlay-hint')).toBeVisible();
      const startBtn = (await page.locator('#action-btn').boundingBox())!;
      expect(startBtn.height, 'Start at least 44px tall').toBeGreaterThanOrEqual(44);
      const startItems = vw > vh ? ['#overlay-title', '#overlay-text', '#action-btn'] : ['#mascot', '#overlay-title', '#overlay-text', '#overlay-keys', '#action-btn', '#overlay-hint'];
      const boxes = [];
      for (const sel of startItems) {
        const b = (await page.locator(sel).boundingBox())!;
        expect(b, sel).not.toBeNull();
        expect(b.y, `${sel} below board top`).toBeGreaterThanOrEqual(board.y + 4);
        expect(b.y + b.height, `${sel} above board bottom`).toBeLessThanOrEqual(board.y + board.height - 4);
        boxes.push(b);
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y, `${startItems[i]} does not overlap ${startItems[i - 1]}`).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
      await page.locator('#action-btn').tap();
      await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
      await expect(page.locator('.dpad')).toHaveAttribute('aria-disabled', 'false');
      const playGeometry = await page.evaluate(() => ['.dpad', '.deck-left', '#board', '.hud', '.foot'].map((s) => JSON.stringify(document.querySelector(s)!.getBoundingClientRect())));
      expect(playGeometry, 'layout identical at idle and during play').toEqual(idleGeometry);
      if (!shortScreen) {
        const playDoc = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
        expect(playDoc.sh, 'no vertical scroll during play').toBeLessThanOrEqual(playDoc.ch + 1);
      }
      for (const sel of ['#pause-btn', '#help-btn', '#mute-btn']) {
        const caption = await page.locator(sel).evaluate((el) => getComputedStyle(el, '::after').content);
        expect(caption, `${sel} has no caption`).toMatch(/^(none|normal|"")$/);
      }
      for (const sel of ['[data-dir="up"]', '[data-dir="left"]', '[data-dir="right"]', '[data-dir="down"]', '#pause-btn', '#help-btn', '#mute-btn']) {
        const b = (await page.locator(sel).boundingBox())!;
        expect(b.width, `${sel} width`).toBeGreaterThanOrEqual(48);
        expect(b.height, `${sel} height`).toBeGreaterThanOrEqual(48);
        expect(b.y + b.height, `${sel} in view`).toBeLessThanOrEqual(vh + 0.5);
      }
      const pause = (await page.locator('#pause-btn').boundingBox())!;
      const up = (await page.locator('[data-dir="up"]').boundingBox())!;
      expect(pause.y, 'pause sits at deck level, not in the HUD').toBeGreaterThan(up.y - 80);
      expect(await page.locator('.hud-buttons .chip').count()).toBe(0);

      // Right-thumb layout: D-pad entirely in the right half, utilities in the left half, no overlap.
      const pad = (await page.locator('.dpad').boundingBox())!;
      const utils = (await page.locator('.deck-left').boundingBox())!;
      const boardBox = (await page.locator('#board').boundingBox())!;
      expect(pad.x + pad.width / 2, 'D-pad centred in the right third').toBeGreaterThanOrEqual(vw * 0.6);
      const frame = (await page.locator('.handheld').boundingBox())!;
      expect(pad.x + pad.width, 'D-pad flush with the frame\'s right side').toBeGreaterThanOrEqual(frame.x + frame.width - 40);
      expect(utils.x + utils.width / 2, 'utilities centred in the left quarter').toBeLessThanOrEqual(vw * 0.3);
      expect(utils.x + utils.width, 'no overlap between utilities and D-pad').toBeLessThanOrEqual(pad.x);
      expect(pad.x + pad.width, 'D-pad inside the viewport').toBeLessThanOrEqual(vw - 6);
      expect(utils.x, 'utilities inside the viewport').toBeGreaterThanOrEqual(6);
      if (vw <= vh) expect(pad.y, 'controls do not cover the board').toBeGreaterThanOrEqual(boardBox.y + boardBox.height - 1);
      // Utilities share one vertical axis with equal gaps.
      const centres: number[] = [];
      const tops: number[] = [];
      for (const sel of ['#pause-btn', '#help-btn', '#mute-btn']) {
        const b = (await page.locator(sel).boundingBox())!;
        centres.push(b.x + b.width / 2);
        tops.push(b.y);
      }
      expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(1.5);
      const gap1 = tops[1]! - tops[0]!;
      const gap2 = tops[2]! - tops[1]!;
      expect(Math.abs(gap1 - gap2)).toBeLessThan(1.5);
    } else {
      await expect(page.locator('body')).toHaveAttribute('data-layout', 'desktop');
      await expect(page.locator('.deck')).toBeHidden();
      expect(await page.locator('.hud-buttons .chip').count()).toBe(3);
    }
  });

  test('touch-only run from start to restart', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'touch projects only');
    const a = page.locator('#pause-btn');
    const b = page.locator('#help-btn');
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');

    await page.locator('[data-dir="up"]').tap();
    await expect.poll(async () => (await getState(page)).dir).toBe('up');

    await placeTokenAhead(page, () => a.tap(), () => a.tap());
    await expect.poll(async () => (await getState(page)).bots.length).toBe(2);
    await expect(page.locator('[data-effect="spawned"]').first()).toBeVisible();
    await expect(page.locator('#bots')).toHaveText('2');

    await a.tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    await expect(a).toHaveAttribute('aria-label', 'Resume');

    await b.tap();
    await expect(page.locator('#help')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    const before = await getState(page);
    await pokeArm(page, 'left'); // the dialog covers the deck; the input guard must also ignore it
    await page.waitForTimeout(200);
    expect((await getState(page)).queue).toEqual(before.queue);
    expect((await getState(page)).dir).toBe(before.dir);
    await page.locator('#help-close').tap();
    await expect(page.locator('#help')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');

    await a.tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    await expect(page.locator('#overlay h2')).toHaveText('Game over');
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    expect((await getState(page)).bots).toHaveLength(1);
  });

  test('chord, hold and sequential presses on the D-pad', async ({ page, hasTouch, browserName }) => {
    test.skip(!hasTouch || browserName !== 'chromium', 'uses CDP touch injection');
    const cdp = await page.context().newCDPSession(page);
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');

    // Chord: thumb lands on ▲ and ◀ together -> one turn (the first), never two.
    const up = await center(page, '[data-dir="up"]');
    const left = await center(page, '[data-dir="left"]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: up.x, y: up.y, id: 0 }, { x: left.x, y: left.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await getState(page)).queue.length).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await getState(page)).dir).toBe('up');
    await page.waitForTimeout(400);
    expect((await getState(page)).dir).toBe('up');
    expect((await getState(page)).status).toBe('running');

    // Hold: pressing ◀ for half a second is a single turn.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: left.x, y: left.y, id: 2 }] });
    await page.waitForTimeout(500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await getState(page)).dir).toBe('left');
    expect((await getState(page)).queue).toEqual([]);

    // Sequential: ▼ then ▶ 120 ms apart are two deliberate turns.
    const down = await center(page, '[data-dir="down"]');
    const right = await center(page, '[data-dir="right"]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: down.x, y: down.y, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: right.x, y: right.y, id: 4 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await getState(page)).dir, { timeout: 3_000 }).toBe('right');
  });

  test('losing focus or being hidden pauses until an explicit resume', async ({ page, hasTouch }) => {
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    const frozen = await getState(page);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(500);
    expect((await getState(page)).tick).toBe(frozen.tick);
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');

    if (hasTouch) await page.locator('#pause-btn').tap();
    else await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
  });

  test('resizing mid-game keeps the state and refits the board', async ({ page, viewport, hasTouch }) => {
    await page.locator('#action-btn').click();
    await expect.poll(async () => (await getState(page)).tick).toBeGreaterThan(0);
    if (hasTouch) await page.locator('#pause-btn').tap();
    else await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    const before = await getState(page);
    const canvasBefore = await page.evaluate(() => (document.getElementById('board') as HTMLCanvasElement).clientWidth);

    // Shrink by 20%, but never below 320x480 (the smallest supported phone) and never grow.
    await page.setViewportSize({
      width: Math.min(viewport!.width, Math.max(320, Math.round(viewport!.width * 0.8))),
      height: Math.min(viewport!.height, Math.max(480, Math.round(viewport!.height * 0.8))),
    });
    await page.waitForTimeout(250);
    const after = await getState(page);
    expect(after.bots).toEqual(before.bots);
    expect(after.score).toBe(before.score);
    expect(after.token).toEqual(before.token);
    expect(after.status).toBe('paused');
    const canvasAfter = await page.evaluate(() => (document.getElementById('board') as HTMLCanvasElement).clientWidth);
    expect(canvasAfter).toBeGreaterThan(0);
    expect(canvasBefore).toBeGreaterThan(0);
    const board = (await page.locator('#board').boundingBox())!;
    const size = page.viewportSize()!;
    expect(board.x + board.width).toBeLessThanOrEqual(size.width + 0.5);
    expect(board.y + board.height).toBeLessThanOrEqual(size.height + 0.5);
    const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(doc.sw).toBeLessThanOrEqual(doc.cw);
  });

  test('desktop: centred when tall, top-aligned and scrollable when short', async ({ page, viewport, hasTouch }) => {
    test.skip(hasTouch, 'desktop layout only');
    const vh = viewport!.height;
    const box = (await page.locator('.handheld').boundingBox())!;
    const topGap = box.y;
    const bottomGap = vh - (box.y + box.height);
    if (vh >= 720) {
      expect(Math.abs(topGap - bottomGap), 'vertically centred').toBeLessThan(2);
    } else {
      expect(topGap, 'top-aligned on short windows').toBeLessThan(24);
    }
    const centreX = box.x + box.width / 2;
    expect(Math.abs(centreX - viewport!.width / 2), 'horizontally centred').toBeLessThan(2);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflowX).toBeLessThanOrEqual(0);
  });

  test('D-pad corners and slides resolve to a single direction each', async ({ page, hasTouch, browserName }) => {
    test.skip(!hasTouch || browserName !== 'chromium', 'uses CDP touch injection');
    const cdp = await page.context().newCDPSession(page);
    await page.locator('#action-btn').tap();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    const pad = (await page.locator('.dpad').boundingBox())!;
    const cx = pad.x + pad.width / 2;
    const cy = pad.y + pad.height / 2;
    const hw = pad.width / 2;
    const touch = async (points: Array<{ x: number; y: number }>, type: 'touchStart' | 'touchMove' | 'touchEnd') =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ ...p, id: i })) });

    // Near the top-right corner but clearly more "up" than "right": one turn, up.
    await touch([{ x: cx + hw * 0.25, y: cy - hw * 0.65 }], 'touchStart');
    await touch([], 'touchEnd');
    await expect.poll(async () => (await getState(page)).dir).toBe('up');

    // Exact diagonal corner: ambiguous, ignored.
    await touch([{ x: cx + hw * 0.7, y: cy + hw * 0.7 }], 'touchStart');
    await touch([], 'touchEnd');
    await page.waitForTimeout(300);
    expect((await getState(page)).queue).toEqual([]);
    expect((await getState(page)).dir).toBe('up');

    // Dead centre: ignored.
    await touch([{ x: cx, y: cy }], 'touchStart');
    await touch([], 'touchEnd');
    expect((await getState(page)).queue).toEqual([]);

    // Slide: press the left arm, slide down to the bottom arm, release -> left, then down.
    await touch([{ x: cx - hw * 0.7, y: cy }], 'touchStart');
    await page.waitForTimeout(60);
    await touch([{ x: cx - hw * 0.2, y: cy + hw * 0.7 }], 'touchMove');
    await touch([], 'touchEnd');
    await expect.poll(async () => (await getState(page)).dir, { timeout: 3_000 }).toBe('down');
    expect((await getState(page)).status).toBe('running');
    expect(await page.locator('.dpad').getAttribute('data-active')).toBeNull();
  });

  test('audio unlocks on Start and recovers after a suspension', async ({ page, hasTouch }) => {
    type AudioWindow = Window & { __swarm: { audioState(): string; suspendAudio(): Promise<void> } };
    const audioState = () => page.evaluate(() => (window as unknown as AudioWindow).__swarm.audioState());
    expect(await audioState()).toBe('none');
    if (hasTouch) await page.locator('#action-btn').tap();
    else await page.keyboard.press('Enter');
    await expect.poll(audioState).toBe('running');
    await page.evaluate(() => (window as unknown as AudioWindow).__swarm.suspendAudio());
    await expect.poll(audioState).toBe('suspended');
    if (hasTouch) await page.locator('#pause-btn').tap();
    else await page.keyboard.press('Space');
    await expect.poll(audioState).toBe('running');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
  });

  test('haptics fire only where supported', async ({ page, hasTouch }) => {
    type HapticWindow = Window & { __swarm: { hapticsSupported(): boolean; lastVibrate(): number | number[] | null } };
    const supported = await page.evaluate(() => (window as unknown as HapticWindow).__swarm.hapticsSupported());
    const last = () => page.evaluate(() => (window as unknown as HapticWindow).__swarm.lastVibrate());
    expect(supported).toBe(hasTouch);
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    if (hasTouch) await page.locator('[data-dir="up"]').tap();
    else await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await getState(page)).dir).toBe('up');
    if (hasTouch) await expect.poll(last).toBe(8);
    else expect(await last()).toBeNull();
    const pause = hasTouch ? () => page.locator('#pause-btn').tap() : () => page.keyboard.press('Space');
    await placeTokenAhead(page, pause, pause);
    await expect.poll(async () => (await getState(page)).bots.length).toBe(2);
    if (hasTouch) await expect.poll(last).toBe(15);
    else expect(await last()).toBeNull();
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    if (hasTouch) await expect.poll(last).toEqual([30, 40, 60]);
    else expect(await last()).toBeNull();
  });

  test('scoreboard keeps its size with large numbers and the HUD stays on one row', async ({ page, hasTouch }) => {
    type ChainWindow = Window & { __swarm: { setChain(n: number): void } };
    const widthOf = async (sel: string) => (await page.locator(sel).boundingBox())!.width;
    const before = await widthOf('.scoreboard');
    const hudBefore = (await page.locator('.hud').boundingBox())!;
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    if (hasTouch) await page.locator('#pause-btn').tap();
    else await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    await page.evaluate(() => (window as unknown as ChainWindow).__swarm.setChain(150));
    await expect(page.locator('#bots')).toHaveText('150');
    const after = await widthOf('.scoreboard');
    expect(Math.abs(after - before), 'no layout shift from 1 to 150').toBeLessThan(1);
    const hudAfter = (await page.locator('.hud').boundingBox())!;
    expect(hudAfter.height).toBeLessThan(hudBefore.height + 1);
    const brand = (await page.locator('.brand').boundingBox())!;
    const board = (await page.locator('.scoreboard').boundingBox())!;
    expect(brand.x + brand.width, 'brand and scoreboard do not overlap').toBeLessThanOrEqual(board.x + 0.5);
    expect(Math.abs(brand.y + brand.height / 2 - (board.y + board.height / 2)), 'brand and scoreboard on one row').toBeLessThan(hudBefore.height / 2);
  });

  test('game over shows the dizzy mascot above the score and Restart', async ({ page, viewport }) => {
    await page.locator('#action-btn').click();
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    await expect(page.locator('#overlay')).toBeVisible();
    const vw = viewport!.width;
    const vh = viewport!.height;
    const shortLandscape = vh < 520 && vw > vh;
    const mascot = page.locator('#mascot');
    if (shortLandscape) {
      await expect(mascot).toBeHidden();
    } else {
      await expect(mascot).toBeVisible();
      await expect.poll(() => mascot.getAttribute('data-frame')).toBe('centre:dizzy:0:0:1');
      expect(await mascot.getAttribute('data-mode')).toBe('over');
      const m = (await mascot.boundingBox())!;
      const title = (await page.locator('#overlay-title').boundingBox())!;
      expect(m.y + m.height).toBeLessThanOrEqual(title.y + 1);
    }
    await expect(page.locator('#overlay-eyebrow')).toBeHidden();
    const btn = (await page.locator('#action-btn').boundingBox())!;
    const board = (await page.locator('#board').boundingBox())!;
    expect(btn.y + btn.height).toBeLessThanOrEqual(board.y + board.height + 0.5);
    await expect(page.locator('#action-btn')).toHaveText('Restart');
  });

  test('a 150-agent chain renders within the frame budget', async ({ page, hasTouch }, testInfo) => {
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await page.evaluate(() => (window as unknown as ReadyWindow).__swarm.setChain(150));
    if (hasTouch) await page.locator('#pause-btn').tap();
    else await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'paused');
    expect((await getState(page)).bots).toHaveLength(150);
    await page.waitForTimeout(2_000);
    const stats = await page.evaluate(() => (window as unknown as ReadyWindow).__swarm.frameStats());
    testInfo.annotations.push({ type: 'frame-stats-150', description: JSON.stringify(stats) });
    expect(stats.samples).toBeGreaterThan(30);
    expect(stats.avgMs).toBeLessThan(25);
  });
});

test.describe('release checks', () => {
  test('page loads from its deployed path with no external requests', async ({ page, baseURL }) => {
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('#overlay-title')).toHaveText('Claude Swarm');
    expect(page.url().startsWith(baseURL!)).toBe(true);
    const assets = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"]')).map((n) => n.getAttribute('src') ?? n.getAttribute('href')),
    );
    for (const a of assets) expect(a, 'relative asset path').toMatch(/^\.\//);
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'none'");
    expect(await page.locator('script:not([src]):not([type="application/ld+json"])').count(), 'no inline scripts under CSP').toBe(0);
    await expect(page).toHaveTitle('Claude Swarm | 90s Retro Game Inspired by Nokia’s Snake | CyberSquad0');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toContain('Consume tokens, spawn agents and grow your swarm.');
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content');
    expect(ogDesc).toBe(description);
    expect(await page.locator('meta[name="robots"]').count(), 'no robots meta (no accidental noindex)').toBe(0);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/^https:\/\/[^/]+\/claude-swarm\/$/);
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og).toBe(`${canonical}social-preview-v4.png`);
    expect(await page.locator('meta[name="twitter:image"]').getAttribute('content')).toBe(og);
    expect(await page.locator('meta[property="og:image:alt"]').getAttribute('content')).toContain('CyberSquad0 + Claude');
    expect(description).toContain('Built by CyberSquad0 + Claude.');
    // Brand forms: uppercase contexts use CYBER SQUAD ZERO literally, so CSS never renders CYBERSQUAD0.
    const footer = await page.locator('.foot').evaluate((el) => ({ rendered: (el as HTMLElement).innerText, transform: getComputedStyle(el).textTransform }));
    expect(footer.transform).toBe('uppercase');
    expect(footer.rendered).toContain('CYBER SQUAD ZERO + CLAUDE');
    expect(footer.rendered).not.toMatch(/CYBERSQUAD0|NORTH OF ZERO/);
    expect(footer.rendered).toContain('NOT AFFILIATED WITH OR ENDORSED BY ANTHROPIC.');
    const credit = page.locator('.foot a.credit-link');
    await expect(credit).toHaveAttribute('href', 'https://www.cs0.dev');
    await expect(credit).toHaveAttribute('rel', /noopener/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
    expect(ld.author).toEqual({ '@type': 'Organization', name: 'CyberSquad0', url: 'https://www.cs0.dev' });
    expect(await page.content()).not.toContain('social-preview-v3.png');
    for (const icon of ['favicon.svg', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png', 'social-preview-v4.png', 'robots.txt']) {
      const res = await page.request.get(new URL(`./${icon}`, page.url()).toString());
      expect(res.status(), icon).toBe(200);
    }
    const html = await page.content();
    expect(html).not.toMatch(/localhost|127\.0\.0\.1|PASTE|example\.com|TODO/i);
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
  });
});

test.describe('square cells', () => {
  type MetricsWindow = Window & {
    __swarm: {
      boardMetrics(): {
        cols: number;
        rows: number;
        backing: [number, number];
        box: [number, number];
        cell: [number, number];
        cellDevice: number;
        dpr: number;
        squareOK: boolean;
        oneToOne: boolean;
      };
    };
  };
  const metrics = (page: Page) => page.evaluate(() => (window as unknown as MetricsWindow).__swarm.boardMetrics());
  const contentBox = (page: Page) =>
    page.evaluate(() => {
      const s = document.querySelector('.screen') as HTMLElement;
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      return { w: r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h: r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) };
    });
  const expectSquare = async (page: Page, label: string) => {
    await page.waitForTimeout(320); // let the settle pass after layout changes run
    const m = await metrics(page);
    const c = await contentBox(page);
    expect(Math.abs(m.cell[0] - m.cell[1]), `${label}: cell ${m.cell[0].toFixed(3)}x${m.cell[1].toFixed(3)}`).toBeLessThan(0.05);
    expect(m.squareOK, `${label}: squareOK`).toBe(true);
    expect(m.box[0], `${label}: box width inside frame content`).toBeLessThanOrEqual(c.w + 0.5);
    expect(m.box[1], `${label}: box height inside frame content`).toBeLessThanOrEqual(c.h + 0.5);
    // The canvas maps 1:1 to device pixels: whole device pixels per cell and a
    // CSS box of exactly backing / dpr, so the browser never resamples it.
    expect(Number.isInteger(m.cellDevice) && m.cellDevice >= 1, `${label}: whole device px per cell (${m.cellDevice})`).toBe(true);
    expect(m.backing, `${label}: backing is cols × cell`).toEqual([m.cols * m.cellDevice, m.rows * m.cellDevice]);
    // getBoundingClientRect is quantised to 1/64 CSS px, hence the 0.05 device px slack.
    expect(Math.abs(m.box[0] * m.dpr - m.backing[0]), `${label}: box × dpr = backing width`).toBeLessThan(0.05);
    expect(Math.abs(m.box[1] * m.dpr - m.backing[1]), `${label}: box × dpr = backing height`).toBeLessThan(0.05);
    expect(m.oneToOne, `${label}: oneToOne`).toBe(true);
    // Whole CSS pixels too (a fractional box drifts off the device grid in both engines).
    // Always reachable at integer ratios; at 2.625x (Pixel 7) only in 21 px steps, so the
    // renderer falls back to the plain fit there when a whole box would cost over 10%.
    if ([1, 2, 3].includes(m.dpr)) {
      expect(Number.isInteger(m.box[0]), `${label}: box width whole CSS px (${m.box[0]})`).toBe(true);
      expect(Number.isInteger(m.box[1]), `${label}: box height whole CSS px (${m.box[1]})`).toBe(true);
    }
    return m;
  };

  test('every grid line is drawn (no resampling drops lines)', async ({ page, hasTouch, errors }) => {
    // Regression for phones: a 960 px backing store shrunk into ~927 device
    // pixels lost every other 1 px grid line under nearest-neighbour sampling.
    await page.goto('./?test&seed=3');
    if (hasTouch) await page.locator('#action-btn').tap();
    else await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await page.waitForTimeout(400);
    const m = await metrics(page);
    const box = await page.locator('#board').boundingBox();
    expect(box).not.toBeNull();
    // Playwright's screenshot machinery injects an inline stylesheet into the page; the
    // page's CSP (style-src 'self') blocks it and WebKit reports that as a console error.
    // That message comes from the test tool, not the game, so it is dropped here only.
    const before = errors.length;
    const img = decodePng(await page.screenshot({ clip: box!, caret: 'initial' }));
    const injected = errors.splice(before).filter((e) => !/Refused to apply a stylesheet/.test(e));
    errors.push(...injected);
    const lines = gridLines(img);
    const expected = { v: m.cols - 1, h: m.rows - 1 };
    const describe = `vertical ${lines.vertical.length} (${pitches(lines.vertical).join(',')}); horizontal ${lines.horizontal.length} (${pitches(lines.horizontal).join(',')}); backing ${m.backing.join('x')} box ${m.box.map((v) => v.toFixed(2)).join('x')} dpr ${m.dpr}`;
    expect(lines.vertical.length, describe).toBe(expected.v);
    expect(lines.horizontal.length, describe).toBe(expected.h);
    for (const p of [pitches(lines.vertical), pitches(lines.horizontal)]) {
      expect(Math.max(...p) - Math.min(...p), `uniform pitch: ${describe}`).toBeLessThanOrEqual(1);
    }
  });

  test('cells stay square through load, play, toolbar changes, rotation and restart', async ({ page, viewport, hasTouch }) => {
    const vw = viewport!.width;
    const vh = viewport!.height;
    await expectSquare(page, 'load');
    if (hasTouch) await page.locator('#action-btn').tap();
    else await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    const playing = await expectSquare(page, 'playing');
    // Drawn head aligns with the logical cell under the CSS cell size.
    const head = await page.evaluate(() => {
      const w = window as unknown as MetricsWindow & { __swarm: { getState(): SwarmState; lastDraw(): Point } };
      return { logical: w.__swarm.getState().bots[0], drawn: w.__swarm.lastDraw() };
    });
    expect(Math.abs(head.drawn.x - head.logical.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(head.drawn.y - head.logical.y)).toBeLessThanOrEqual(1);

    // Browser toolbar show/hide: viewport height changes while the game runs.
    for (const h of [vh - 90, vh - 200, vh]) {
      await page.setViewportSize({ width: vw, height: Math.max(300, h) });
      await expectSquare(page, `height ${h}`);
    }
    // Rotation and back.
    await page.setViewportSize({ width: vh, height: vw });
    await expectSquare(page, 'rotated');
    await page.setViewportSize({ width: vw, height: vh });
    const back = await expectSquare(page, 'back');
    expect(back.backing).toEqual(playing.backing);

    // Game over and restart keep the same sizing.
    await expect.poll(async () => (await getState(page)).status, { timeout: 15_000 }).toBe('over');
    await expectSquare(page, 'game over');
    if (hasTouch) await page.locator('#action-btn').tap();
    else await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
    await expectSquare(page, 'restart');
  });
});

test.describe('keyboard activation', () => {
  test('Enter and Space activate the focused button instead of being swallowed by the game keys', async ({ page, hasTouch }) => {
    const body = page.locator('body');
    // Start screen: Space on the focused Start button starts the game.
    await page.locator('#action-btn').focus();
    await page.keyboard.press('Space');
    await expect(body).toHaveAttribute('data-status', 'running');

    // D-pad arms (visible and enabled during play on touch layouts): Enter and Space steer.
    if (hasTouch) {
      const heading = (await getState(page)).dir;
      const [first, second] = heading === 'left' || heading === 'right' ? ['up', 'left'] : ['left', 'up'];
      await page.locator(`[data-dir="${first}"]`).focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await getState(page)).dir, { timeout: 3000 }).toBe(first);
      await page.locator(`[data-dir="${second}"]`).focus();
      await page.keyboard.press('Space');
      await expect.poll(async () => (await getState(page)).dir, { timeout: 3000 }).toBe(second);
    }

    // Pause chip: Enter pauses (not restart), Space resumes.
    await page.locator('#pause-btn').focus();
    await page.keyboard.press('Enter');
    await expect(body).toHaveAttribute('data-status', 'paused');

    // Mute chip: Enter and Space each toggle it.
    const mute = page.locator('#mute-btn');
    const wasMuted = (await mute.getAttribute('aria-pressed')) === 'true';
    await mute.focus();
    await page.keyboard.press('Enter');
    await expect(mute).toHaveAttribute('aria-pressed', String(!wasMuted));
    await mute.focus();
    await page.keyboard.press('Space');
    await expect(mute).toHaveAttribute('aria-pressed', String(wasMuted));

    // Help chip: Enter opens the dialog, Escape closes it, Space opens it again.
    const help = page.locator('#help');
    await page.locator('#help-btn').focus();
    await page.keyboard.press('Enter');
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await page.locator('#help-btn').focus();
    await page.keyboard.press('Space');
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    await page.locator('#pause-btn').focus();
    await page.keyboard.press('Space');
    await expect(body).toHaveAttribute('data-status', 'running');
  });
});

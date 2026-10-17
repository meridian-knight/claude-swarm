import { expect, test as base, type Page } from '@playwright/test';

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
  __swarm: { getState(): SwarmState; placeToken(p: Point): void; step(): void };
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
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await use(errors);
      expect(errors, 'browser console must stay clean').toEqual([]);
    },
    { auto: true },
  ],
});

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
  await page.goto('/?test&seed=42');
});

test('shows the start screen, instructions, HUD and fan-game label', async ({ page, isMobile }) => {
  await expect(page.locator('body')).toHaveAttribute('data-status', 'idle');
  const overlay = page.locator('#overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('h2')).toHaveText('Claude Swarm');
  if (isMobile) {
    await expect(overlay.locator('.mini-dpad')).toBeVisible();
    await expect(overlay.locator('#overlay-controls')).toContainText('D-pad or swipe');
  } else {
    await expect(overlay.locator('.keys-cluster')).toHaveCount(2);
    await expect(overlay.locator('.key')).toHaveCount(10);
    await expect(overlay.locator('#overlay-controls')).toContainText('Space');
    await expect(overlay.locator('#overlay-controls')).toContainText('Enter');
  }
  await expect(overlay.locator('#overlay-text')).toHaveText('Collect tokens to grow your chain. Avoid walls and yourself.');
  await expect(page.locator('#action-btn')).toHaveText('Start');
  await expect(page.getByText('A fan game developed by North of Zero and Claude.')).toBeVisible();
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

  test('collecting a token spawns a bot, scores and shows the effect', async ({ page }) => {
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

  test('collecting a token on touch spawns a bot', async ({ page }) => {
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
    await expect(page.getByText('A fan game developed by North of Zero and Claude.')).toBeVisible();
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
    if (isMobile) await page.locator('[data-dir="up"]').tap();
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

  test('help dialog and start screen fit the viewport', async ({ page, viewport }) => {
    const vw = viewport!.width;
    const vh = viewport!.height;
    const shortLandscape = vh < 520 && vw > vh;
    const required = shortLandscape
      ? ['#overlay-title', '#overlay-controls', '#action-btn']
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

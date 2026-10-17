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
  if (isMobile) {
    await expect(overlay.locator('.mini-dpad')).toBeVisible();
    await expect(overlay.locator('#overlay-controls')).toContainText('D-pad');
    await expect(overlay.locator('#overlay-controls')).toContainText('A pause');
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

  test('collecting a chip bursts briefly and still spawns a bot', async ({ page, isMobile }) => {
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
    expect(doc.sh, 'no vertical scroll').toBeLessThanOrEqual(doc.ch + 1);

    const board = (await page.locator('#board').boundingBox())!;
    if (vw > vh) expect(board.height).toBeGreaterThanOrEqual(vh * 0.6);
    else if (hasTouch && vw <= 430) expect(board.width).toBeGreaterThanOrEqual(vw * 0.76);

    const canvas = await page.evaluate(() => {
      const c = document.getElementById('board') as HTMLCanvasElement;
      return { w: c.width, css: c.clientWidth };
    });
    expect(canvas.w % 240, 'integer sprite scale').toBe(0);
    if (doc.dpr < 2) expect(Math.abs(canvas.css - canvas.w / doc.dpr), 'crisp on 1x').toBeLessThan(1);

    if (hasTouch) {
      await expect(page.locator('body')).toHaveAttribute('data-layout', 'touch');
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

    // Shrink by 20% but never below 320px, the narrowest phone we support.
    await page.setViewportSize({
      width: Math.max(320, Math.round(viewport!.width * 0.8)),
      height: Math.max(480, Math.round(viewport!.height * 0.8)),
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

  test('a 150-bot chain renders within the frame budget', async ({ page, hasTouch }, testInfo) => {
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
    expect(await page.locator('script:not([src])').count(), 'no inline scripts under CSP').toBe(0);
    await page.locator('#action-btn').click();
    await expect(page.locator('body')).toHaveAttribute('data-status', 'running');
  });
});

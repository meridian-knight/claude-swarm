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
  await expect(overlay.locator('#overlay-keys')).toContainText(isMobile ? 'D-pad' : 'Enter start');
  await expect(page.locator('#action-btn')).toHaveText('Start');
  await expect(page.getByText('Unofficial fan game. Not affiliated with or endorsed by Anthropic.')).toBeVisible();
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
    await expect(page.locator('.hint')).toBeVisible();
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
    expect(board!.width).toBeGreaterThan(vw * 0.7);

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

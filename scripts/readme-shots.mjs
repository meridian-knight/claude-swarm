// README screenshots from a local preview. Needs the window.__swarm hook, which only the e2e build has:
// npm run build:e2e && npm run preview (port 4173), then: npm run shots
import { chromium, devices } from '@playwright/test';
const out = process.argv[2] ?? 'docs';
const browser = await chromium.launch();
async function grow(page, n, pause, resume) {
  for (let i = 0; i < n; i++) {
    await pause();
    const s = await page.evaluate(() => window.__swarm.getState());
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.dir];
    await page.evaluate((p) => window.__swarm.placeToken(p), { x: s.bots[0].x + v[0], y: s.bots[0].y + v[1] });
    await resume();
    await page.waitForFunction((len) => window.__swarm.getState().bots.length >= len, i + 2, { timeout: 3000 });
  }
}
// Desktop: 1280x800 at 2x for crispness, cropped to the handheld frame.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/?test&seed=7');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  await grow(page, 7, () => page.keyboard.press('Space'), () => page.keyboard.press('Space'));
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const box = await page.locator('.handheld').boundingBox();
  await page.screenshot({ path: `${out}/screenshot-desktop.png`, clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 } });
  await ctx.close();
}
// Mobile: Pixel 7 portrait, full viewport.
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4173/?test&seed=7');
  await page.locator('#action-btn').tap();
  await page.locator('[data-dir="up"]').tap();
  await page.waitForTimeout(200);
  await grow(page, 5, () => page.locator('#pause-btn').tap(), () => page.locator('#pause-btn').tap());
  await page.locator('[data-dir="left"]').tap();
  await page.waitForTimeout(300);
  const frame = await page.locator('.handheld').boundingBox();
  await page.screenshot({ path: `${out}/screenshot-mobile.png`, clip: { x: 0, y: 0, width: 412, height: Math.ceil(frame.y + frame.height + 12) } });
  await ctx.close();
}
await browser.close();
console.log('readme screenshots written');

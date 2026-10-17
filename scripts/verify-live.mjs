import { chromium, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
// Read-only live checks (desktop + Pixel 7 emulation). Usage: node scripts/verify-live.mjs [baseUrl]
const BASE = process.argv[2] ?? 'https://meridian-knight.github.io/claude-swarm/';
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

// Release identity: live index.html equals the local build output.
{
  const res = await fetch(BASE, { cache: 'no-store' });
  const live = await res.text();
  const local = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  check('live index.html byte-equal to local dist (current dist)', live === local, `${live.length} vs ${local.length} bytes`);
}

async function session(label, ctxOpts, touch) {
  let geomIdle = null;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errors.push('failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  const hosts = new Set();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  const state = () => page.evaluate(() => window.__swarm.getState());

  const res = await page.goto(BASE + '?test', { waitUntil: 'load' });
  check(`${label}: direct load`, res.status() === 200);
  await page.reload({ waitUntil: 'load' });
  check(`${label}: refresh`, await page.locator('#board').isVisible());
  const meta = await page.evaluate(() => ({
    title: document.title,
    desc: document.querySelector('meta[name=description]')?.content,
    ogImage: document.querySelector('meta[property="og:image"]')?.content,
    canonical: document.querySelector('link[rel=canonical]')?.href,
    startText: document.getElementById('overlay-text')?.textContent,
    rule: document.getElementById('overlay-keys')?.textContent,
    agentsLabel: document.querySelector('.scoreboard')?.textContent?.includes('Agents'),
    hudMascot: (() => { const c = document.getElementById('hud-mascot'); return c ? c.getBoundingClientRect().height : 0; })(),
    footer: document.querySelector('.foot')?.innerText?.replace(/\s+/g, ' ').trim(),
    layout: document.body.dataset.layout,
  }));
  check(`${label}: title credits CyberSquad0`, meta.title === 'Claude Swarm | 90s Retro Game Inspired by Nokia’s Snake | CyberSquad0', meta.title);
  check(`${label}: description (agents copy, CyberSquad0 credit)`, (meta.desc || '').startsWith('Consume tokens, spawn agents and grow your swarm.') && (meta.desc || '').endsWith('Built by CyberSquad0 + Claude.'), meta.desc);
  check(`${label}: canonical + og:image v4`, meta.canonical === BASE && meta.ogImage === BASE + 'social-preview-v4.png');
  check(`${label}: start copy`, meta.startText === 'Consume tokens. Spawn agents. Grow your swarm.' && meta.rule === 'Avoid the walls and your own swarm.');
  check(`${label}: scoreboard says Agents`, meta.agentsLabel === true);
  check(`${label}: header mascot drawn`, meta.hudMascot > 0 && meta.hudMascot <= 28, `${meta.hudMascot}px`);
  check(`${label}: footer rendered as CYBER SQUAD ZERO`, /A FAN GAME BUILT BY CYBER SQUAD ZERO \+ CLAUDE\./.test(meta.footer) && !/CYBERSQUAD0|NORTH OF ZERO/.test(meta.footer) && /NOT AFFILIATED WITH OR ENDORSED BY ANTHROPIC\./.test(meta.footer), meta.footer);
  const credit = await page.evaluate(() => { const a = document.querySelector('.foot a.credit-link'); return a ? { href: a.href, rel: a.rel, text: a.innerText } : null; });
  check(`${label}: credit link to cs0.dev`, !!credit && credit.href === 'https://www.cs0.dev/' && /noopener/.test(credit.rel) && credit.text === 'CYBER SQUAD ZERO', JSON.stringify(credit));
  check(`${label}: layout`, meta.layout === (touch ? 'touch' : 'desktop'));
  for (const p of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'social-preview-v4.png', 'robots.txt']) {
    const r = await page.request.get(BASE + p);
    check(`${label}: ${p}`, r.status() === 200);
  }
  if (touch) {
    const idle = await page.evaluate(() => ({ dpadVisible: getComputedStyle(document.querySelector('.dpad')).display !== 'none', dpadInert: document.querySelector('.dpad').getAttribute('aria-disabled') === 'true', utils: ['pause-btn', 'help-btn', 'mute-btn'].every((id) => document.getElementById(id).getBoundingClientRect().height >= 44), legend: getComputedStyle(document.getElementById('overlay-controls')).display === 'none', hint: document.getElementById('overlay-hint').textContent }));
    check(`${label}: start screen: full deck visible, D-pad inert, legend off, hint shown`, idle.dpadVisible && idle.dpadInert && idle.utils && idle.legend && idle.hint === 'Use the D-pad or swipe to move.', JSON.stringify(idle));
    geomIdle = await page.evaluate(() => ['.dpad', '.deck-left', '#board'].map((q) => JSON.stringify(document.querySelector(q).getBoundingClientRect())));
    await page.locator('[data-dir="up"]').tap({ force: true });
    await page.waitForTimeout(250);
    check(`${label}: D-pad tap does not start a game`, (await page.evaluate(() => document.body.dataset.status)) === 'idle');
    const startBox = await page.locator('#action-btn').boundingBox();
    const boardBox = await page.locator('#board').boundingBox();
    const mascotBox = await page.locator('#mascot').boundingBox();
    check(`${label}: mascot and Start inside the board`, mascotBox.y >= boardBox.y && startBox.y + startBox.height <= boardBox.y + boardBox.height && startBox.height >= 44, `start h=${startBox.height}`);
  }
  // Play
  if (touch) await page.locator('#action-btn').tap(); else await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.dataset.status === 'running');
  if (touch) {
    const vw = ctxOpts.viewport.width;
    await page.waitForSelector('.dpad', { state: 'visible' });
    const pad = await page.locator('.dpad').boundingBox();
    const utils = await page.locator('.deck-left').boundingBox();
    check(`${label}: D-pad right, utilities left during play`, pad.x + pad.width / 2 > vw * 0.6 && utils.x + utils.width / 2 < vw * 0.3);
    const geomPlay = await page.evaluate(() => ['.dpad', '.deck-left', '#board'].map((q) => JSON.stringify(document.querySelector(q).getBoundingClientRect())));
    check(`${label}: layout identical at idle and during play`, JSON.stringify(geomPlay) === JSON.stringify(geomIdle));
  }
  const audio = await page.evaluate(() => window.__swarm.audioState());
  check(`${label}: audio context running after Start`, audio === 'running', audio);
  const board = await page.evaluate(() => window.__swarm.boardMetrics());
  check(`${label}: board maps 1:1 to device pixels, square cells`, board.oneToOne === true && board.squareOK === true && Number.isInteger(board.cellDevice), JSON.stringify(board));
  if (touch) await page.locator('[data-dir="up"]').tap(); else await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => window.__swarm.getState().dir === 'up', null, { timeout: 3000 });
  check(`${label}: steer`, true);
  const hap = await page.evaluate(() => ({ s: window.__swarm.hapticsSupported(), v: window.__swarm.lastVibrate() }));
  check(`${label}: haptics ${touch ? 'fire on turn' : 'inactive on desktop'}`, touch ? hap.s && hap.v === 8 : !hap.s && hap.v === null, JSON.stringify(hap));
  if (touch) {
    // Corner touch resolves to one direction; exact diagonal ignored.
    const cdp = await ctx.newCDPSession(page);
    const pad = await page.locator('.dpad').boundingBox();
    const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2, hw = pad.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - hw * 0.65, y: cy - hw * 0.25, id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.__swarm.getState().dir === 'left', null, { timeout: 3000 });
    check(`${label}: corner touch resolves to dominant axis`, true);
  }
  const pause = () => (touch ? page.locator('#pause-btn').tap() : page.keyboard.press('Space'));
  await pause();
  await page.waitForFunction(() => document.body.dataset.status === 'paused');
  const s = await state();
  const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.dir];
  await page.evaluate((p) => window.__swarm.placeToken(p), { x: s.bots[0].x + v[0], y: s.bots[0].y + v[1] });
  await pause();
  await page.waitForFunction(() => window.__swarm.getState().bots.length === 2, null, { timeout: 3000 });
  check(`${label}: collect + spawn`, (await state()).score === 1);
  await page.locator('#help-btn').click();
  await page.waitForFunction(() => document.body.dataset.status === 'paused');
  await page.locator('#help-close').click();
  await page.waitForFunction(() => document.body.dataset.status === 'running');
  check(`${label}: help pauses and resumes`, true);
  await page.waitForFunction(() => window.__swarm.getState().status === 'over', null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const over = await page.evaluate(() => ({ mode: document.getElementById('mascot').dataset.mode, frame: document.getElementById('mascot').dataset.frame, hidden: document.getElementById('mascot').hidden }));
  check(`${label}: game-over mascot dizzy`, over.mode === 'over' && over.frame === 'centre:dizzy:0:0:1' && !over.hidden, JSON.stringify(over));
  if (touch) await page.locator('#action-btn').tap(); else await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.dataset.status === 'running');
  check(`${label}: restart`, (await state()).bots.length === 1);
  check(`${label}: best stored`, (await page.evaluate(() => localStorage.getItem('claude-swarm:best'))) === '1');
  await page.locator('#mute-btn').click();
  check(`${label}: mute toggle`, (await page.locator('#mute-btn').getAttribute('aria-pressed')) === 'true');
  check(`${label}: zero console/asset errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  check(`${label}: same-origin only`, [...hosts].every((h) => h === 'meridian-knight.github.io'), [...hosts].join(','));
  await ctx.close();
}
await session('desktop', { viewport: { width: 1280, height: 800 } }, false);
await session('pixel7', { ...devices['Pixel 7'] }, true);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
process.exit(failed.length ? 1 : 0);

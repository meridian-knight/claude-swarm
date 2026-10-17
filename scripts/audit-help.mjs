import { chromium } from '@playwright/test';
// Read-only help-dialog fit audit across phone viewports. Usage: BASE_URL=... node scripts/audit-help.mjs
const BASE = process.env.BASE_URL ?? 'https://meridian-knight.github.io/claude-swarm/?test';
const browser = await chromium.launch();
for (const [name, w, h, dpr] of [['android-small', 360, 640, 2], ['android-small-bars', 360, 560, 2], ['iphone-se', 375, 667, 2], ['pixel7', 412, 915, 2.625], ['se-landscape', 667, 375, 2], ['pixel7-landscape-bars', 915, 300, 2.625]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('#help-btn').tap();
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const panel = document.querySelector('.modal-panel');
    return { vh: innerHeight, panel: r('.modal-panel'), scroll: panel.scrollHeight - panel.clientHeight, title: r('#help-title'), legend: r('#help-controls'), cols: [...document.querySelectorAll('#help-controls .control-group')].map((g) => { const b = g.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; }), labels: [...document.querySelectorAll('#help-controls .control-label')].map((l) => l.textContent.trim()), rules: r('.rules'), close: r('#help-close'), text: document.getElementById('help-controls').innerText.replace(/\s+/g, ' ').trim() };
  });
  const fits = m.panel.y >= 0 && m.panel.y + m.panel.h <= m.vh;
  console.log(`${name} ${w}x${h}: panel ${m.panel.w}x${m.panel.h}@y${m.panel.y} fits=${fits} innerScroll=${m.scroll}px | legend ${m.legend.w}x${m.legend.h} cols=${m.cols.join(',')} (${Math.round(100 * m.legend.h / m.panel.h)}% of panel) | rules h${m.rules.h} | close ${m.close.w}x${m.close.h} | labels: ${m.labels.join(' / ')}`);
  await ctx.close();
}
await browser.close();

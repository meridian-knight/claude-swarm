// Generates favicon.svg, PNG icons, favicon.ico and the 1200x630 social preview
// from the same 12x12 pixel grids the game draws.
// Usage: node scripts/make-assets.mjs <outDir> [previewFileName]
// Example: npm run assets   (writes into public/, preview as social-preview-v2.png)
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'public';
const previewName = process.argv[3] ?? 'social-preview-v2.png';
mkdirSync(out, { recursive: true });

const SHARED = { E: '#2a1810', M: '#160c07', G: '#ffe9d6', K: '#f7c948', A: '#f3e6cf', S: '#b8862a', C: '#f3e6cf', H: '#fff6e6', T: '#d97757', P: '#9a4f36' };
const TONES = {
  leader: { D: '#7a3b22', O: '#e8895f', L: '#f8b98e', g: '#5a2c1a', d: '#c76a4a' },
  a: { D: '#7a3b22', O: '#d97757', L: '#f4a97a', g: '#5a2c1a', d: '#b85f42' },
  b: { D: '#73361f', O: '#cf6d4e', L: '#eb9c70', g: '#52281a', d: '#ad5839' },
};
const blank = () => Array.from({ length: 12 }, () => Array(12).fill('.'));
const put = (g, x, y, k) => { if (x >= 0 && y >= 0 && x < 12 && y < 12) g[y][x] = k; };

function bot(kind, tone, legFrame = 0, gaze = 'centre') {
  const g = blank();
  for (let x = 1; x <= 10; x++) { put(g, x, 1, 'D'); put(g, x, 8, 'D'); }
  for (let y = 2; y <= 7; y++) { put(g, 0, y, 'D'); put(g, 11, y, 'D'); for (let x = 1; x <= 10; x++) put(g, x, y, 'O'); }
  put(g, 1, 2, 'L'); put(g, 2, 2, 'L'); put(g, 1, 3, 'L');
  if (kind === 'head') put(g, 5, 0, 'A');
  let ex = 0; if (gaze === 'right') ex = 1; if (gaze === 'left') ex = -1;
  for (const bx of [3, 7]) {
    if (kind === 'head') { put(g, bx + ex, 3, 'E'); put(g, bx + 1 + ex, 3, 'E'); put(g, bx + ex, 4, 'E'); put(g, bx + 1 + ex, 4, 'E'); put(g, bx + ex, 3, 'G'); }
    else { put(g, bx, 3, 'd'); put(g, bx + 1, 3, 'd'); put(g, bx, 4, 'E'); put(g, bx + 1, 4, 'E'); }
  }
  if (kind === 'head') for (let x = 4; x <= 7; x++) put(g, x, 6, 'E'); else { put(g, 5, 6, 'E'); put(g, 6, 6, 'E'); }
  for (const x of [[1, 4, 7, 10], [2, 4, 7, 9]][legFrame]) { put(g, x, 9, 'g'); put(g, x, 10, 'g'); }
  return { g, pal: { ...SHARED, ...TONES[tone] } };
}
function chip() {
  const g = blank();
  for (let i = 3; i <= 8; i++) { put(g, i, 2, 'T'); put(g, i, 9, 'T'); put(g, 2, i, 'T'); put(g, 9, i, 'T'); }
  for (let y = 3; y <= 8; y++) for (let x = 3; x <= 8; x++) put(g, x, y, 'C');
  put(g, 3, 3, 'H'); put(g, 4, 3, 'H'); put(g, 3, 4, 'H');
  for (const i of [4, 7]) { put(g, i, 1, 'P'); put(g, i, 10, 'P'); put(g, 1, i, 'P'); put(g, 10, i, 'P'); }
  for (const y of [5, 6]) for (const x of [5, 6]) put(g, x, y, 'K');
  for (const c of [5, 6]) { put(g, c, 3, 'T'); put(g, c, 8, 'T'); put(g, 3, c, 'T'); put(g, 8, c, 'T'); }
  return { g, pal: SHARED };
}
const rects = ({ g, pal }, ox = 0, oy = 0) => g.flatMap((row, y) => row.map((k, x) => pal[k] ? `<rect x="${ox + x}" y="${oy + y}" width="1" height="1" fill="${pal[k]}"/>` : '').filter(Boolean)).join('');
const svgDoc = (w, h, body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${bg}${body}</svg>`;

// --- favicon.svg: the leader bot, transparent background
const icon = svgDoc(12, 12, rects(bot('head', 'leader')));
writeFileSync(join(out, 'favicon.svg'), icon);
// Opaque, rounded variant for Apple / Android home screens.
const iconOpaque = svgDoc(12, 12, rects(bot('head', 'leader')), '<rect width="12" height="12" rx="1.5" fill="#241c16"/>');

// --- social preview 1200x630
const chain = [['head', 'leader', 0, 'right'], ['body', 'a', 1], ['body', 'b', 0], ['body', 'a', 1], ['body', 'b', 0], ['body', 'a', 1], ['body', 'b', 0]];
const S = 8; // px per sprite pixel => 96px bots
let chainSvg = '';
chain.forEach((c, i) => { chainSvg += rects(bot(...c), (chain.length - 1 - i) * 12, 0); });
const chipSvg = rects(chip(), chain.length * 12 + 6, 0);
const sceneW = (chain.length * 12 + 18) * S;
const social = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1200px;height:630px;overflow:hidden;background:#15110e;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#efe4d3}
  .glow{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 20%, rgba(217,119,87,.16), transparent 60%)}
  .frame{position:absolute;inset:36px;border:3px solid #3a2d23;border-radius:34px;box-shadow:inset 0 0 0 10px #241c16}
  .eyebrow{position:absolute;top:92px;left:0;right:0;text-align:center;font-size:20px;letter-spacing:.32em;color:#9b8b78;text-transform:uppercase}
  h1{position:absolute;top:126px;left:0;right:0;margin:0;text-align:center;font-size:96px;font-weight:800;letter-spacing:.14em;color:#d97757;text-shadow:5px 5px 0 #9a4f36,0 0 36px rgba(217,119,87,.45);text-transform:uppercase}
  .tag{position:absolute;top:262px;left:0;right:0;text-align:center;font-size:30px;letter-spacing:.06em;color:#f3e6cf}
  .scene{position:absolute;left:50%;top:330px;transform:translateX(-50%);width:${sceneW}px;height:${12 * S}px}
  .scene svg{width:100%;height:100%;image-rendering:pixelated}
  .foot{position:absolute;bottom:78px;left:0;right:0;text-align:center;font-size:22px;letter-spacing:.2em;color:#9b8b78;text-transform:uppercase}
  .grid{position:absolute;inset:46px;border-radius:26px;background:repeating-linear-gradient(90deg,transparent 0 47px,rgba(255,255,255,.025) 47px 48px),repeating-linear-gradient(0deg,transparent 0 47px,rgba(255,255,255,.025) 47px 48px)}
</style></head><body>
  <div class="glow"></div><div class="grid"></div><div class="frame"></div>
  <div class="eyebrow">Snake-inspired retro fan game</div>
  <h1>Claude Swarm</h1>
  <div class="tag">Consume tokens. Spawn agents. Grow your swarm.</div>
  <div class="scene">${svgDoc(chain.length * 12 + 18, 12, chainSvg + chipSvg)}</div>
  <div class="foot">Unofficial fan game · North of Zero + Claude</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(social);
await page.screenshot({ path: join(out, previewName), clip: { x: 0, y: 0, width: 1200, height: 630 } });

async function pngFromSvg(svg, size, file, transparent) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:${transparent ? 'transparent' : '#241c16'}}img{display:block;width:${size}px;height:${size}px;image-rendering:pixelated}</style></head><body><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
  await page.screenshot({ path: join(out, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}
await pngFromSvg(icon, 16, 'favicon-16.png', true);
await pngFromSvg(icon, 32, 'favicon-32.png', true);
await pngFromSvg(icon, 48, 'favicon-48.png', true);
await pngFromSvg(iconOpaque, 180, 'apple-touch-icon.png', false);
await pngFromSvg(iconOpaque, 192, 'icon-192.png', false);
await pngFromSvg(iconOpaque, 512, 'icon-512.png', false);
await browser.close();

// --- favicon.ico: PNG-in-ICO container with 16/32/48 entries
const entries = [16, 32, 48].map((s) => ({ s, data: readFileSync(join(out, `favicon-${s}.png`)) }));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + 16 * entries.length;
const dir = Buffer.concat(entries.map(({ s, data }) => {
  const b = Buffer.alloc(16);
  b.writeUInt8(s === 256 ? 0 : s, 0); b.writeUInt8(s === 256 ? 0 : s, 1); b.writeUInt8(0, 2); b.writeUInt8(0, 3);
  b.writeUInt16LE(1, 4); b.writeUInt16LE(32, 6); b.writeUInt32LE(data.length, 8); b.writeUInt32LE(offset, 12);
  offset += data.length; return b;
}));
writeFileSync(join(out, 'favicon.ico'), Buffer.concat([header, dir, ...entries.map((e) => e.data)]));
unlinkSync(join(out, 'favicon-48.png')); // only needed inside the ICO
console.log('assets written');

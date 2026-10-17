// Serves ./dist under a sub-path (default /claude-swarm/) to verify relative asset paths.
// Usage: node scripts/serve-dist.mjs [port] [subpath]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4174);
const subpath = (process.argv[3] ?? '/claude-swarm/').replace(/\/?$/, '/');
const root = join(process.cwd(), 'dist');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const waitForBuild = async () => {
  const deadline = Date.now() + 120_000;
  while (!existsSync(join(root, 'index.html'))) {
    if (Date.now() > deadline) throw new Error('dist/index.html never appeared');
    await new Promise((r) => setTimeout(r, 500));
  }
};

await waitForBuild();
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(subpath)) {
    res.writeHead(404).end('not under ' + subpath);
    return;
  }
  let rel = url.pathname.slice(subpath.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`serving dist at http://127.0.0.1:${port}${subpath}`));

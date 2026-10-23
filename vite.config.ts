import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Content Security Policy for the static production page. GitHub Pages cannot
 * send headers, so the policy ships as a <meta> tag (which is also why there
 * is no frame-ancestors: browsers ignore it in a meta tag). It is injected only
 * at build time, so `vite dev` runs without a CSP and HMR's injected styles
 * keep working; violations show up in build, preview and e2e runs.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const CSP_ANCHOR = '<meta charset="UTF-8" />';

const cspMeta = (): Plugin => ({
  name: 'claude-swarm-csp-meta',
  apply: 'build',
  transformIndexHtml(html) {
    // A silent miss would ship the page without any policy.
    if (!html.includes(CSP_ANCHOR)) throw new Error(`CSP anchor ${CSP_ANCHOR} not found in index.html`);
    return html.replace(CSP_ANCHOR, `${CSP_ANCHOR}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
});

export default defineConfig({
  base: './',
  plugins: [cspMeta()],
  server: { port: 5173, host: '127.0.0.1' },
  preview: { port: 4173, host: '127.0.0.1' },
  // No modulepreload polyfill: the bundle is one chunk, and the polyfill's fetch() would be blocked by connect-src 'none' anyway.
  build: { target: 'es2022', sourcemap: false, modulePreload: { polyfill: false } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});

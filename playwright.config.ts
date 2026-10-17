import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SUBPATH_PORT = 4174;
const SUBPATH_URL = `http://127.0.0.1:${SUBPATH_PORT}/claude-swarm/`;

/** Only the layout, readiness and start-screen checks run on the extra viewports. */
const MATRIX_ONLY = /mobile readiness|fit the viewport|start screen|square cells|grid line/;

const touch = (width: number, height: number, deviceScaleFactor = 2) => ({
  viewport: { width, height },
  deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
});

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-short', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 640 } }, grep: MATRIX_ONLY },
    { name: 'android-small', use: touch(360, 640), grep: MATRIX_ONLY },
    { name: 'iphone-se', use: touch(375, 667), grep: MATRIX_ONLY },
    { name: 'android-small-bars', use: touch(360, 560), grep: MATRIX_ONLY },
    { name: 'iphone-se-bars', use: touch(375, 553), grep: MATRIX_ONLY },
    { name: 'iphone-14pro', use: touch(393, 852, 3), grep: MATRIX_ONLY },
    { name: 'landscape', use: { ...devices['Pixel 7 landscape'] }, grep: MATRIX_ONLY },
    { name: 'iphone-se-landscape', use: touch(667, 375), grep: MATRIX_ONLY },
    { name: 'ipad', use: touch(820, 1180), grep: MATRIX_ONLY },
    {
      name: 'subpath',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: SUBPATH_URL },
      grep: /start screen|release checks/,
    },
    // WebKit (Safari engine) emulation of iPhones: the closest available stand-in for
    // iOS Safari / Chrome, which both run WebKit. Requires: npx playwright install webkit
    { name: 'webkit-iphone-14pro', use: { ...devices['iPhone 14 Pro'] }, grep: /square cells|start screen/ },
    { name: 'webkit-iphone-se', use: { ...devices['iPhone SE'] }, grep: /square cells|start screen/ },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `node scripts/serve-dist.mjs ${SUBPATH_PORT}`,
      url: SUBPATH_URL,
      reuseExistingServer: true,
      timeout: 150_000,
    },
  ],
});

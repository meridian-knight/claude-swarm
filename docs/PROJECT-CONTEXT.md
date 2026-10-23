# Claude Swarm: project context and handover

Read this first when resuming development. It records what the game is, the decisions that shaped it, how it is built, tested and deployed, and what is still open. Last updated 2026-10-23 for release 1.2.6 (audit cleanup and re-audit fixes).

## What it is

A static browser game, Snake with a swarm: the player steers an orange pixel "agent", consumes tokens, and every token spawns another agent that follows the leader's exact path. Walls and the swarm itself end the run; filling the board wins. No backend, no accounts, no AI API, no network traffic after load. "Agents" is the figurative name for the characters; they are canvas sprites.

- Live: https://meridian-knight.github.io/claude-swarm/
- Repository: https://github.com/meridian-knight/claude-swarm (branch `main` deploys; `visual-polish` is the working branch and is kept fast-forwarded onto `main`)
- Stack: Vite 8, TypeScript 5.9, Vitest, Playwright. No runtime dependencies.

## Brand and copy rules (fixed)

- Tagline: **Consume tokens. Spawn agents. Grow your swarm.**
- Terms: tokens (collectibles), agents (characters, never "bots"), swarm (the group).
- Creator: uppercase contexts use **CYBER SQUAD ZERO**; mixed case uses **CyberSquad0**; abbreviation if ever needed **Cs0**; site https://www.cs0.dev.
- Credits: uppercase **BUILT BY CYBER SQUAD ZERO + CLAUDE**, mixed case **Built by CyberSquad0 + Claude.** The footer is uppercase via CSS, so the uppercase form is written literally there; never place "CyberSquad0" inside an element with `text-transform: uppercase`.
- Disclaimer (keep): "Not affiliated with or endorsed by Anthropic." plus "Unofficial fan game".
- Page title: "Claude Swarm | 90s Retro Game Inspired by Nokia’s Snake | CyberSquad0".
- Social preview: `public/social-preview-v4.png`. Bump the version number on every artwork change and update every reference: `index.html` (og:image, twitter:image, JSON-LD image), the default in `scripts/make-assets.mjs`, `scripts/verify-live.mjs` and the release test in `tests/e2e/game.spec.ts`.

## Architecture

```
src/game/      pure rules, no DOM: createGame, startGame, restartGame, step, queueDirection,
               togglePause, spawnToken, tickInterval. The rules have not changed since the
               first release; the 1.2.6 cleanup only removed unused exports from directions.ts.
src/ui/        renderer (canvas, sprite cache, interpolation, vignette), art (the 12x12 grids
               and palettes, DOM-free, also imported by scripts/make-assets.mjs), sprites
               (paints the grids at any device scale),
               visual (prev positions, particles, timers), hud (overlays, scoreboard), help
               (dialog, focus trap), input (keyboard, D-pad surface, swipe, chord guard),
               audio (WebAudio blips, unlock on every gesture), haptics (navigator.vibrate on
               touch only), layout (moves pause/help/sound between HUD and deck), mascot,
               effects, controls (legend markup), storage (localStorage best + mute).
src/main.ts    wiring, rAF loop with accumulator, pause on blur/pagehide/visibility,
               ?test hook (window.__swarm) used by browser tests, present only in dev and
               `vite build --mode e2e` bundles (never in production); ?seed for determinism.
index.html     markup, metadata, CSP (injected at build by vite.config.ts), JSON-LD.
src/style.css  retro handheld theme; breakpoints for touch (coarse pointer or <=700px),
               short phones (<=680px tall), narrow (<=400px, <=340px), tablets, short landscape.
public/        icons, social preview, .nojekyll (copied into dist as-is); robots.txt is inert on
               a project sub-path (crawlers read the user-site root) and kept only as a no-op.
scripts/       make-assets.mjs (icons + preview from src/ui/art.ts), readme-shots.mjs,
               serve-dist.mjs (sub-path test server), verify-live.mjs (50 checks on production,
               63 on an e2e build), audit-start.mjs, audit-help.mjs (read-only checks against a
               URL; BASE_URL env overrides the default).
tests/unit     32 Vitest cases: 30 for the rules (movement, growth, scoring, collisions, tail
               edge case, reversal prevention, pause, restart, win, speed, token placement)
               and 2 for pixelEdges.
tests/e2e      Playwright matrix, 14 projects (desktop, short desktop, six phone sizes incl.
               browser-bars heights, two landscapes, iPad, sub-path, two WebKit iPhones);
               246 tests listed, ~218 run after the per-project skips; png.ts decodes board
               screenshots to count drawn grid lines.
```

## Key behaviours and decisions

- Direction input uses a 2-deep queue validated against the last queued direction, so rapid presses never reverse. The tail cell is safe to enter unless eating.
- Speed: 180 ms per step at one agent, minus 5 ms per agent, floor 70 ms.
- Touch deck: D-pad on the right as a single touch surface (dominant axis, centre dead zone, diagonal band ignored, slide-to-turn, chord within 60 ms ignored, no auto-repeat); pause, help and sound stacked on the left. The whole handheld is visible from first load in every state; the D-pad is dimmed and inert until a game runs. A D-pad tap never starts a game.
- Mobile start screen: mascot, "Unofficial fan game", title, tagline, rule, Start, hint "Use the D-pad or swipe to move." Desktop keyboard keycaps show only on desktop. The touch help dialog shows one D-pad diagram, the movement hint and the rules.
- Portrait phones keep a 288 px minimum for the frame content; with whole device pixels per cell the canvas inside is 280 to 288 px. Short screens scroll naturally instead of clipping.
- Audio unlocks on pointerdown, pointerup, touchend, click and keydown and resumes a suspended context; a silent buffer kick helps older iOS. Mute persists in localStorage.
- Haptics: 8 ms on turn, 15 ms on spawn, 30/40/60 ms on death, only where `navigator.vibrate` exists on a coarse-pointer device (Android). iOS has no vibration API.
- Reduced motion disables interpolation, particles, bump, shake, mascot motion and transitions.
- Pause on `blur`, `pagehide` and `visibilitychange`; resume is always explicit. Opening help pauses and closing resumes only if the game was running.
- Keyboard: Enter and Space on a focused button activate that button (the game handler ignores them there); arrows and WASD always steer; keys with Ctrl, Cmd or Alt are left to the browser. When the overlay opens for a non-idle state, focus moves to Resume / Restart. Closing help by keyboard returns focus to the help button; closing it by pointer leaves nothing focused.
- Game over: 150 ms bump into the obstacle, dizzy leader face, chain dims tail to head, overlay after 450 ms with the dizzy mascot.
- CSP meta (self-only, no connections) ships with the production page; GitHub Pages cannot send headers.
- Board sizing (rule since 1.2.4, completed in 1.2.5): the canvas always maps 1:1 to device pixels and its CSS box is a whole number of CSS pixels. The renderer measures the frame's content box (padding excluded), picks a cell of whole device pixels (`floor(fit × devicePixelRatio)`, lowered by at most 10% until `cols × cell / dpr` is an integer, e.g. steps of 3 px at 3×, 21 px at 2.625×; snapped down to a sprite multiple when that costs under 10% of the area, 25% on 1× screens), sets the backing store to `cols × cellDevice` and the CSS box to exactly `backing / dpr`. Nothing is ever resampled, so cells are square and every 1 px grid line is one device pixel. A fractional CSS box (940 device px = 313.33 CSS px) was measured to drift by a pixel and drop a line in both WebKit and Chromium even at a 1:1 size, which is why the whole-CSS-pixel condition exists. Sprites are rasterised at `cellDevice / 12` device px per sprite pixel with rounded edges (`pixelEdges` in `sprites.ts`), so fractional scales stay crisp. History: 1.2.3 removed the CSS `max-width`/`max-height` clamps (WebKit applied only one axis and stretched the grid); the remaining phone symptom was dropped grid lines, caused by a 960 px backing store shrunk into ~927 device pixels under nearest-neighbour sampling (measured on the owner's iPhone Chrome screenshot: every second horizontal line missing; reproduced in Chromium "Pixel 7" emulation, which the `grid line` Playwright test now guards). Playwright WebKit filters downscales differently from iOS and does not show that symptom, so the real phone is the acceptance test. Resizes coalesce per frame with a 250 ms settle pass for toolbar and rotation changes. `?debug` shows a sizing readout (`1:1 true` expected) for on-device checks; `window.__swarm.boardMetrics()` under `?test`. WebKit (`webkit-2287`) is in Playwright's shared cache, so the `webkit-iphone-*` projects run with plain `npm run test:e2e`.

## Commands

```
npm install
npm run dev            # http://127.0.0.1:5173/
npm run typecheck
npm test               # unit tests
npm run test:e2e       # Playwright matrix (needs: npx playwright install chromium webkit)
npm run build          # dist/
npm run build:e2e      # dist/ with the window.__swarm hook (what Playwright serves)
npm run preview        # serve dist/ on 4173
npm run assets         # regenerate icons + social preview (bump the version first)
npm run shots          # README screenshots (run npm run build:e2e && npm run preview first)
node scripts/verify-live.mjs [url]   # live checks, desktop + Pixel 7 emulation; hook-dependent
                                     # checks are skipped on production (no __swarm); run
                                     # npm run build first so the byte-equal check uses a production dist
node scripts/audit-start.mjs         # start screen / deck fit across 11 phone viewports (BASE_URL=... to override)
node scripts/audit-help.mjs          # help dialog fit across 6 viewports (BASE_URL=... to override)
```

## Release process

1. Work on `visual-polish`, keep `src/game/**` unchanged unless rules are meant to change.
2. Run typecheck, unit tests, build, full Playwright matrix; scan the diff for secrets.
3. Commit; `git tag -a vX.Y.Z`; `git switch main && git merge --ff-only visual-polish`; `git push origin main visual-polish vX.Y.Z`.
4. `.github/workflows/deploy-pages.yml` (SHA-pinned actions, lockfile install, unit tests + build with typecheck, a guard that fails if `dist` lacks the CSP or contains `__swarm`, deploys only `dist`) publishes on push to `main`. Pages source is "GitHub Actions"; the `github-pages` environment allows only `main`. Playwright does not run in CI.
5. Verify: run `npm run build` again (the e2e run leaves an e2e `dist`), check live `index.html` is byte-equal to local `dist/index.html`, run `node scripts/verify-live.mjs`; then `git tag -a deployed-vX.Y.Z main` and push the tag.
6. Rollback: `git revert` on `main` and push. Never force-push.

## Release history

| Tag | Content |
|---|---|
| `pre-visual-polish` | working game before polish |
| `pre-security-audit` | before CSP, ignore rules, workflow |
| `v1.0.0` / `deployed-v1.0.0` | first public release |
| `v1.1.0` / `deployed-v1.1.0` | right-thumb controls, haptics, audio unlock, header mascot, scoreboard, game-over mascot, agents copy, README |
| `v1.1.1` / `deployed-v1.1.1` | compact start screen, "+ Claude" credits, versioned preview |
| `v1.2.0` / `deployed-v1.2.0` | CyberSquad0 branding, CYBER SQUAD ZERO uppercase form, cs0.dev link |
| `v1.2.1` / `deployed-v1.2.1` | full handheld visible from first load on mobile, inert D-pad at idle, 288 px board minimum |
| `v1.2.2` / `deployed-v1.2.2` | touch help dialog with a single D-pad legend |
| `v1.2.3` / `deployed-v1.2.3` | square cells by construction (no CSS clamps), `?debug` readout, WebKit test projects |
| `v1.2.4` / `deployed-v1.2.4` | canvas mapped 1:1 to device pixels, fractional sprite scale with rounded edges, grid-line screenshot test |
| `v1.2.5` / `deployed-v1.2.5` | CSS box also a whole number of CSS pixels (fractional boxes drifted off the pixel grid at 3×) |
| `v1.2.6` / `deployed-v1.2.6` | audit cleanup: keyboard activation of focused buttons, test hook only in dev/e2e builds, dead code removed, shared art module; re-audit fixes: modifier keys ignored, pointer help-close drops focus, swipe capture, focus into overlays, a11y markup, tighter CSP with injection guard, CI bundle guard, script robustness. History rewritten to the noreply email before this release. |

## Verified on physical devices (owner, 2026-10-17)

- iPhone: sound works and follows the ring/silent switch; frame and D-pad visible without scrolling on a tall phone, address-bar-open layout scrolls rather than clips, help dialog shows the single D-pad, landscape keeps the board uncovered.
- Android: not yet verified on hardware (vibration and sound).

## Open items

- GitHub repository description, website and topics are set (description: "Claude Swarm: a retro Snake-inspired fan game. Consume tokens. Spawn agents. Grow your swarm. Built by CyberSquad0 + Claude."; website: the Pages URL; topics: game, snake, retro, browser-game, typescript, vite, github-pages, fan-game). Change them with `gh repo edit` when logged in.
- No licence file by choice; add one deliberately if the project should be reusable.
- Social cards cached by platforms before 1.2.0 may show older artwork until re-scraped.

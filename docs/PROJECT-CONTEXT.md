# Claude Swarm: project context and handover

Read this first when resuming development. It records what the game is, the decisions that shaped it, how it is built, tested and deployed, and what is still open. Last updated for release 1.2.2 (commit `6073e3f`, 2026-10-17).

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
- Social preview: `public/social-preview-v4.png`. Bump the version number on every artwork change and update all four references in `index.html` (og:image, og:image:secure_url, twitter:image, JSON-LD image) plus the release test.

## Architecture

```
src/game/      pure rules, no DOM: createGame, startGame, step, queueDirection, togglePause,
               spawnToken, tickInterval. Treated as frozen since the first release; every
               later change was verified against SHA-256 hashes of these files.
src/ui/        renderer (canvas, sprite cache, interpolation, vignette), sprites (12x12 grids),
               visual (prev positions, particles, timers), hud (overlays, scoreboard), help
               (dialog, focus trap), input (keyboard, D-pad surface, swipe, chord guard),
               audio (WebAudio blips, unlock on every gesture), haptics (navigator.vibrate on
               touch only), layout (moves pause/help/sound between HUD and deck), mascot,
               effects, controls (legend markup), storage (localStorage best + mute).
src/main.ts    wiring, rAF loop with accumulator, pause on blur/pagehide/visibility,
               ?test hook (window.__swarm) used by browser tests, ?seed for determinism.
index.html     markup, metadata, CSP (injected at build by vite.config.ts), JSON-LD.
src/style.css  retro handheld theme; breakpoints for touch (coarse pointer or <=700px),
               short phones (<=680px tall), narrow (<=400px, <=340px), tablets, short landscape.
public/        icons, social preview, robots.txt, .nojekyll (copied into dist as-is).
scripts/       make-assets.mjs (icons + preview from sprite grids), readme-shots.mjs,
               serve-dist.mjs (sub-path test server), verify-live.mjs, audit-start.mjs,
               audit-help.mjs (read-only checks against a URL).
tests/unit     30 Vitest cases for the rules (movement, growth, scoring, collisions, tail
               edge case, reversal prevention, pause, restart, win, speed).
tests/e2e      Playwright matrix, 12 projects (desktop, short desktop, five phone sizes incl.
               browser-bars heights, two landscapes, iPad, sub-path), ~186 tests.
```

## Key behaviours and decisions

- Direction input uses a 2-deep queue validated against the last queued direction, so rapid presses never reverse. The tail cell is safe to enter unless eating.
- Speed: 180 ms per step at one agent, minus 5 ms per agent, floor 70 ms.
- Touch deck: D-pad on the right as a single touch surface (dominant axis, centre dead zone, diagonal band ignored, slide-to-turn, chord within 60 ms ignored, no auto-repeat); pause, help and sound stacked on the left. The whole handheld is visible from first load in every state; the D-pad is dimmed and inert until a game runs. A D-pad tap never starts a game.
- Mobile start screen: mascot, "Unofficial fan game", title, tagline, rule, Start, hint "Use the D-pad or swipe to move." Desktop keyboard keycaps show only on desktop. The touch help dialog shows one D-pad diagram, the movement hint and the rules.
- Portrait phones keep a 288 px board minimum; short screens scroll naturally instead of clipping.
- Audio unlocks on pointerdown, pointerup, touchend, click and keydown and resumes a suspended context; a silent buffer kick helps older iOS. Mute persists in localStorage.
- Haptics: 8 ms on turn, 15 ms on spawn, 30/40/60 ms on death, only where `navigator.vibrate` exists on a coarse-pointer device (Android). iOS has no vibration API.
- Reduced motion disables interpolation, particles, bump, shake, mascot motion and transitions.
- Pause on `blur`, `pagehide` and `visibilitychange`; resume is always explicit. Opening help pauses and closing resumes only if the game was running.
- Game over: 150 ms bump into the obstacle, dizzy leader face, chain dims tail to head, overlay after 450 ms with the dizzy mascot.
- CSP meta (self-only, no connections) ships with the production page; GitHub Pages cannot send headers.
- Board sizing (fixed after 1.2.2): the renderer measures the frame's content box (padding excluded), derives one CSS cell size that fits both axes, and sets the canvas width and height from it; the backing store is an integer sprite scale. There is deliberately no CSS `max-width`/`max-height` on the canvas: WebKit applied only the width clamp, which stretched the grid into rectangular cells on iPhones (reproduced in Playwright WebKit: 15.85 × 16.00 px cells on the 1.2.2 build). Resizes coalesce per frame with a 250 ms settle pass for toolbar and rotation changes. `?debug` shows a sizing readout for on-device checks; `window.__swarm.boardMetrics()` under `?test`. WebKit projects run with `PLAYWRIGHT_BROWSERS_PATH` pointing at a folder where `npx playwright install webkit` succeeded.

## Commands

```
npm install
npm run dev            # http://127.0.0.1:5173/
npm run typecheck
npm test               # unit tests
npm run test:e2e       # Playwright matrix (needs: npx playwright install chromium)
npm run build          # dist/
npm run preview        # serve dist/ on 4173
npm run assets         # regenerate icons + social preview (bump the version first)
npm run shots          # README screenshots (run npm run preview first)
node scripts/verify-live.mjs [url]   # 61 live checks, desktop + Pixel 7 emulation
node scripts/audit-start.mjs         # start screen / deck fit across 11 phone viewports
node scripts/audit-help.mjs          # help dialog fit across 6 viewports
```

## Release process

1. Work on `visual-polish`, keep `src/game/**` unchanged unless rules are meant to change.
2. Run typecheck, unit tests, build, full Playwright matrix; scan the diff for secrets.
3. Commit; `git tag -a vX.Y.Z`; `git switch main && git merge --ff-only visual-polish`; `git push origin main visual-polish vX.Y.Z`.
4. `.github/workflows/deploy-pages.yml` (SHA-pinned actions, lockfile install, typecheck + unit tests + build, deploys only `dist`) publishes on push to `main`. Pages source is "GitHub Actions"; the `github-pages` environment allows only `main`.
5. Verify: live `index.html` byte-equal to local `dist/index.html`; `node scripts/verify-live.mjs`; then `git tag -a deployed-vX.Y.Z main` and push the tag.
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

## Verified on physical devices (owner, 2026-10-17)

- iPhone: sound works and follows the ring/silent switch; frame and D-pad visible without scrolling on a tall phone, address-bar-open layout scrolls rather than clips, help dialog shows the single D-pad, landscape keeps the board uncovered.
- Android: not yet verified on hardware (vibration and sound).

## Open items

- GitHub repository description, website and topics are set (description: "Claude Swarm: a retro Snake-inspired fan game. Consume tokens. Spawn agents. Grow your swarm. Built by CyberSquad0 + Claude."; website: the Pages URL; topics: game, snake, retro, browser-game, typescript, vite, github-pages, fan-game). Change them with `gh repo edit` when logged in.
- No licence file by choice; add one deliberately if the project should be reusable.
- Social cards cached by platforms before 1.2.0 may show older artwork until re-scraped.

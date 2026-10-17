# Claude Swarm

A fan game developed by North of Zero and Claude. Not affiliated with or endorsed by Anthropic.

Snake, with a swarm: steer a little orange pixel bot, collect chips, and every chip adds another bot to your chain. Hit a wall or your own swarm and the run is over. Fill the board to win.

Everything runs in the browser. There is no backend, no account, no AI API and no network traffic: the bots are canvas sprites.

## Play

- Desktop: arrow keys or WASD to move, Space to pause, Enter to start or restart, `?` for help.
- Touch: D-pad or swipe to move, A to pause, B for help.
- Best score and the sound setting are saved in your browser's localStorage only.

## Develop

```
npm install
npm run dev        # http://127.0.0.1:5173/
npm run typecheck
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests (Playwright, desktop + mobile matrix)
npm run build      # production build in dist/
npm run preview    # serve dist/ locally
```

## Deploy

The site is static and uses relative asset paths, so it works at a domain root or under a repository sub-path. `.github/workflows/deploy-pages.yml` builds and publishes `dist/` to GitHub Pages on every push to `main` (set Pages → Source to "GitHub Actions" once).

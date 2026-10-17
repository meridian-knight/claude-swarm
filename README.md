# Claude Swarm

A fan game developed by North of Zero and Claude. Not affiliated with or endorsed by Anthropic.

Snake, with a swarm: steer a little orange pixel agent, consume tokens, and every token spawns another agent into your swarm. Hit a wall or your own swarm and the run is over. Fill the board to win.

Everything runs in the browser. There is no backend, no account, no AI API and no network traffic. "Agents" is the game's name for its characters: they are canvas sprites, not real AI agents.

## Play

- Desktop: arrow keys or WASD to move, Space to pause, Enter to start or restart, `?` for help.
- Touch: D-pad on the right (or swipe) to move; pause, help and sound buttons on the left.
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

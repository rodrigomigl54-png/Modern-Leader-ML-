# CLAUDE.md — permanent rules for every session

Modern Leader (code name ML) is a turn-based geopolitical grand-strategy web game.

## Start of every session

- Read `docs/GDD.md` and `PROGRESS.md` first. The GDD is the source of truth; never change a design decision in it without asking Dario.
- Continue from the "Next" section of `PROGRESS.md`.

## Architecture

- Keep the three layers separate (GDD section 2):
  - `src/sim/` — simulation core. Pure TypeScript. Never import PixiJS, presentation code or touch the DOM (enforced by ESLint).
  - `data/` — game data as JSON.
  - `src/map/`, `src/ui/` — presentation. Reads simulation state and changes it **only through command objects** (`InvestCommand`, `MoveArmyCommand`, ...), never directly.
- The simulation must be deterministic: seeded random only, never `Math.random()` in `src/sim/` (enforced by ESLint). Same save + same seed = same result.
- All game data lives in JSON under `data/`, never hard-coded.
- All UI text goes through `t()` from `src/i18n` (add keys to both `en.json` and `sr.json`; a test checks they match).
- Code, comments and commit messages in English.

## Quality

- Write tests for every simulation rule.
- Run `npm run lint`, `npm run format:check`, `npm test` and `npm run build` before every commit.
- Every phone-facing feature must work with touch and on small screens.

## End of every session

- Update `PROGRESS.md` (what was done, what is next, known issues), commit and push.

## Commands

- `npm run dev` — local dev server
- `npm test` — Vitest
- `npm run lint` / `npm run format` — ESLint / Prettier
- `npm run build` — typecheck + production build into `dist/`
- `npm run data:download` / `npm run data:build` / `npm run data:validate` — map data pipeline (`tools/README.md`). Generated files in `data/modern/` are never edited by hand.

Deployment: GitHub Actions (`.github/workflows/deploy.yml`) tests, builds and deploys to GitHub Pages on every push to `main`. Pull requests run the checks without deploying. Vite `base` is `/Modern-Leader-ML-/` (the repository name).

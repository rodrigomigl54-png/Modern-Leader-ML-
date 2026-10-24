# PROGRESS

Live game: https://rodrigomigl54-png.github.io/Modern-Leader-ML-/

## Phases (GDD section 16)

| #   | Phase                                                          | Status                                            |
| --- | -------------------------------------------------------------- | ------------------------------------------------- |
| 0   | Project setup                                                  | Done in code — waiting for the check on the phone |
| 1   | Map data pipeline                                              | Not started                                       |
| 2   | Map rendering                                                  | Not started                                       |
| 3   | Countries and setup screens                                    | Not started                                       |
| 4   | Turn engine and saves                                          | Not started                                       |
| 5   | Economy                                                        | Not started                                       |
| 6   | Population                                                     | Not started                                       |
| 7   | Military                                                       | Not started                                       |
| 8   | Missiles, drones, air defense, nuclear                         | Not started                                       |
| 9   | Diplomacy                                                      | Not started                                       |
| 10  | Resources and trade                                            | Not started                                       |
| 11  | AI                                                             | Not started                                       |
| 12  | Summits, events, notifications, reports, news, advisors, goals | Not started                                       |
| 13  | Balance, polish, demo release                                  | Not started                                       |

## Phase 0 — Project setup

Done:

- Vite + TypeScript (strict) + PixiJS 8 + Vitest; ESLint (typescript-eslint) and Prettier.
- Folders: `src/sim`, `src/map`, `src/ui`, `src/i18n`, `data/modern`, `tools`, `docs` (GDD moved to `docs/GDD.md`).
- ESLint guards the sim layer: no PixiJS / map / ui / i18n imports, no DOM globals, no `Math.random()`.
- Translation system: `src/i18n` with `en.json`, `sr.json` and `t(key, params)`; language switch in a temporary settings stub (gear button, top right); choice remembered in the browser.
- Placeholder app: full-screen PixiJS canvas, centered "Modern Leader", version and build date in the bottom-left corner; handles resize, device pixel ratio and safe areas; no page scroll on phones.
- GitHub Actions: lint, format check, tests and build on every push and PR; deploy to GitHub Pages on push to `main`.
- Tests: trivial `clamp` test in `src/sim`, i18n tests (including en/sr key parity).

Decisions:

- Repository is `Modern-Leader-ML-` (not `modern-leader` as in the GDD), so the Vite base path is `/Modern-Leader-ML-/`.
- Work happens on a feature branch and reaches `main` through a pull request that Dario merges.
- TypeScript is pinned to 6.0.x because typescript-eslint does not support TypeScript 7 yet.

## Next

- Dario: merge the PR, enable GitHub Pages (Settings → Pages → Source: GitHub Actions), open the link on the phone.
- Then Phase 1 — map data pipeline (Prompt 1 in GDD section 17).

## Known issues

- None.

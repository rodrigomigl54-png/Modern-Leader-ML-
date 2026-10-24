# PROGRESS

Live game: https://rodrigomigl54-png.github.io/Modern-Leader-ML-/

## Phases (GDD section 16)

| #   | Phase                                                          | Status                                            |
| --- | -------------------------------------------------------------- | ------------------------------------------------- |
| 0   | Project setup                                                  | Done (live on GitHub Pages)                       |
| 1   | Map data pipeline                                              | Done in code — waiting for review                 |
| 2   | Map rendering                                                  | Done (checked on the phone: smooth, up to 50 fps) |
| 3   | Countries and setup screens                                    | Done                                              |
| 4   | Turn engine and saves                                          | Done in code — waiting for the check on the phone |
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

## Phase 1 — Map data pipeline

Done:

- Pipeline in `tools/map/` (TypeScript run by Node 22): `npm run data:download`, `npm run data:build`, `npm run data:validate`. How it works and every output file: `tools/README.md`. All decisions live in `tools/map/config.json`.
- Source: Natural Earth 1:10m v5.1.2 (public domain), pinned release. Raw files are cached in `tools/.cache/` (not committed); outputs in `data/modern/` are committed. Two runs produce identical files.
- 4603 provinces: all 4596 admin-1 regions, none merged, plus 7 pieces split off for South Ossetia and Transnistria.
- 204 countries: 196 full (193 UN members + Vatican, Palestine, Taiwan), 7 disputed, plus Antarctica as uninhabited.
- 9159 cities (1817 generated at province centroids), 2671 ports, 5385 draft sea routes.
- Province ID map: Miller projection, 16384 × 10559 px in 12 PNG tiles (max 4096 px). Borders traced from the ID map.
- Validation (`tools/validate`) is part of `npm test`. It checks owners, references, symmetric neighbors, capitals, cities per province, ports, routes, and every pixel of the ID map. It also reports file sizes: 9.0 MB raw / 3.4 MB gzipped in total.
- Country names (en/sr) in `src/i18n/countries.*.json`, used through `t('country.XXX')`.

Decisions (Dario, 2026-10-24):

- Ukraine as in Natural Earth: Crimea under Russia, the rest under Ukraine. A front line can be added later as a province split.
- Antarctica stays on the map as a neutral, uninhabited, non-playable territory (status `uninhabited`).
- Dependencies belong to their sovereign (Greenland → Denmark, Hong Kong → China, Puerto Rico → USA, …). Leases stay with the host state: Guantanamo → Cuba, Baikonur → Kazakhstan.
- Siachen Glacier → India; Spratly Islands → Vietnam.
- Western Sahara by de facto control, as in Natural Earth: Morocco holds the western ~3/4 (incl. Laayoune), and Western Sahara (ESH) is the Polisario-held area east of the berm (~91,000 km², capital Bir Lehlou).

Other decisions (listed in `data/modern/map/build-report.json`):

- Disputed ids: XKX Kosovo, ESH Western Sahara, XNC Northern Cyprus, XAB Abkhazia, XSO South Ossetia, XTR Transnistria, XSL Somaliland. Abkhazia, South Ossetia and Transnistria are cut out with Natural Earth's disputed-area polygons.
- Capital = the official capital as the country defines it (e.g. Pretoria, Sucre, Dodoma, Yamoussoukro, Porto-Novo, Astana). For Palestine it is Ramallah, the seat of government, because East Jerusalem is not under its control.
- North Nicosia added as a city (Natural Earth has no point there); "Nur-Sultan" renamed to Astana.
- Small unclaimed areas with no admin-1 region (Bir Tawil, Southern Patagonian Ice Field, Cyprus buffer zone, a few reefs) are "unowned land", not provinces.
- Navigable sea = world ocean + Caspian. Suez, Panama, Bosphorus and Dardanelles are forced open.

## Phase 2 — Map rendering

Done:

- Full world map with PixiJS (WebGL), rendered from the province ID map. A shader looks up each province's color in a palette texture, so recoloring all provinces is one small texture upload.
- Tile pyramid (pipeline change): 4 levels of 1024 px tiles (`data/modern/map/tiles/L0..L3`). The coarsest level is always loaded. Finer tiles load only for the visible area (max 24 cached, evicted LRU), so a phone never holds the full 16384 px map in GPU memory.
- Borders are drawn in the shader with a constant screen width: country borders and coasts clear, province borders subtle and fading out when zoomed out. They work at mediump precision, so they are safe on any phone GPU.
- Controls: drag to pan, wheel and pinch to zoom, inertia after a flick, zoom limits, and the map cannot be lost off-screen.
- Tap or click a province: amber highlight plus an HTML dossier panel (name, owner, area, cities with capital/port badges). It closes with one tap (× or tapping the sea).
- Labels: country names when zoomed out, then capitals, provinces and cities as you zoom in. Greedy collision avoidance, constant screen size, country names through `t()`.
- Map mode framework (`src/map/mapModes.ts`) with the Political mode. Countries get calm colors that differ from their neighbors.
- Loading screen with progress. The FPS counter is hidden and toggled in the settings stub (remembered).
- The map renders only when something changes (an idle map uses no GPU/battery).
- Tests: camera, tile math, palette, country coloring, label anchors and placement (`src/map/map.test.ts`). Checked in Chromium with phone emulation: load, tap → panel, pinch zoom, drag, inertia, no console errors.

## Phase 3 — Countries and setup screens

Done:

- Main menu: New Game (Modern World — Recommended), the nine historical modes as locked "Coming soon" cards, Load Game (disabled until Phase 4), Settings. The feedback button stays hidden until there is a form link.
- New game setup (GDD section 3):
  - Step 1: AI aggressiveness (Peaceful / Realistic, the default / Aggressive / Chaos).
  - Step 2: country chosen on the map or from a searchable, sortable list. It shows the flag, GDP, population, army, allies, rivals, wars and 1–5 difficulty stars. Only full-status countries are selectable.
  - Step 3: leader name, showing who the player replaces, plus a summary.
- Disputed territories setting (Neutral / As states / As part of parent state). It changes the game data at load time (`src/sim/world.ts`), not just the map. It sits on the country step, because it decides which countries are playable, and is also a default in ⚙.
- Starting a game (`src/sim/newGame.ts`) creates the game state, replaces only the player's leader, and shows a top bar (flag, country, leader, date) with the player's country in signature amber with a glowing border. Main menu asks for confirmation before leaving the game.
- Difficulty stars (`src/sim/difficulty.ts`) are computed from data only. Factors: power (GDP, military spending, manpower), GDP per capita, stability (WGI), allies vs rivals, and active wars. Weights: power 65 %, GDP per capita 15 %, stability 10 %, alliances 10 %, war −0.05. Stars are spread by ranking (10/15/20/25/30 %). Result: USA, China, Germany, UK, France, Japan 1★; Russia, India 2★; Serbia 3★; Montenegro 4★; microstates and failed states 5★.
- Data:
  - `leaders.json`: 203 leaders, 45 marked `verify`.
  - `diplomacy.json`: NATO, EU, CSTO, GCC, AES and 9 bilateral pacts; 33 rivalries, each with a reason; the Russia–Ukraine war (`verify`).
  - `scenario.json`: start date 2027-01-01 and the disputed territories with their parents.
  - `flags/`: 199 public-domain flags (hampusborgos/country-flags, pinned commit) plus 5 simplified disputed-territory flags and a black neutral flag (`npm run data:flags`).
- Translations: leader titles, alliances, the self-used names of disputed territories, and all new screens in English and Serbian.
- Validation covers leaders, flags, diplomacy references, the scenario and stat ranges.

- Country stats (`npm run data:stats -- --mirror`), decided with Dario to keep going without network access:
  - GDP (2023) and population (2025): World Bank data from the pinned github.com/datasets mirrors.
  - Armed forces and military spending: drafted estimates (IISS and SIPRI public figures, rounded) in `tools/countries/estimates.json`.
  - Taiwan's GDP and population come from its national statistics.
  - Political stability is empty for now.
  - Every value not taken from the World Bank is marked with a `*Source` field.

## Phase 4 — Turn engine and saves

Done:

- Turn engine (`src/sim/turn.ts`): one turn = one week. The ten phases run in the GDD section 5 order (AI orders → missiles → movement → battles → construction → economy → population → diplomacy → events → autosave). The system phases are empty slots that later phases fill. Every 10 turns a report event is raised (shown in Phase 12), and a new-year event at year change.
- Determinism: a seeded random generator (`src/sim/rng.ts`) keeps its state in the game state. Same save + same seed = same result (tested over 30 turns, and loaded saves continue identically).
- Commands (`src/sim/commands.ts`): the union that later systems extend. No command exists yet.
- Saves (`src/sim/save.ts`): JSON with a format marker and version, a migration hook, and validation that refuses foreign, newer or damaged files.
- Storage (`src/app/saveStore.ts`): IndexedDB with an autosave and 5 manual slots. Falls back to memory with a warning when storage is blocked. Export as a `.json` file; import from a file.
- UI:
  - The Next Turn button sits bottom right (Enter also works on a PC). The top bar shows the date and week.
  - In-game menu: Resume, Save game, Load game, Export save, Import save, Settings, Exit to main menu.
  - Main menu → Load Game lists the autosave and slots, with import.
  - Toasts appear for saved/exported/errors.
  - The game autosaves at the start and after every turn.
- Checked in Chromium with phone emulation: 3 turns → week 4, save to slot 1, page reload → load slot 1, export → import. No console errors.

## Next

- Dario: merge the PR and check on the phone: play a few turns, save, close the page, load again. Try export and import.
- Then Phase 5 — economy (budget, taxes, investment, buildings, inflation, printing money).

## Known issues

- Leaders and wars are drafted from information known up to mid-2026. Elections and events before the start date need a check.
- Military figures are drafted estimates until the World Bank API is allowed. Political stability is missing, so it does not affect the difficulty yet.
- No GDP data: North Korea, Vatican, and the disputed territories except Kosovo and Palestine.
- Disputed territories use simplified flags drawn for the game (Abkhazia, South Ossetia, Transnistria, Northern Cyprus, Somaliland).

- Province names come from Natural Earth's `name` field (local romanization; some are dated, e.g. "Kiev City", "L'viv"). They need a review before release.
- Disputed territories use short names for now. The self-used names (GDD section 4, Neutral mode) belong to Phase 3.
- Generated cities have population 0 until Phase 3 data.
- 55 coastal provinces have no port: no city within 50 km of the sea.
- 408 provinces are under 10 px on the full map. They can be tapped when zoomed in, but they have no enlarged tap target yet.
- Borders are drawn from the ID map pixels, so at maximum zoom they show a slight pixel staircase. The vector borders in `map/borders.json` are available if smoother lines are needed later.
- A border running exactly along a tile edge can miss a 1-pixel segment (the shader does not sample across tiles).
- Frame rate was not measured on a real phone (the test browser uses software rendering). Please check with the FPS counter.
- Sea routes are a nearest-port graph and will be refined in Phase 7.

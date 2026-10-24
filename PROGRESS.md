# PROGRESS

Live game: https://rodrigomigl54-png.github.io/Modern-Leader-ML-/

## Phases (GDD section 16)

| #   | Phase                                                          | Status                                            |
| --- | -------------------------------------------------------------- | ------------------------------------------------- |
| 0   | Project setup                                                  | Done (live on GitHub Pages)                       |
| 1   | Map data pipeline                                              | Done in code — waiting for review                 |
| 2   | Map rendering                                                  | Done (checked on the phone: smooth, up to 50 fps) |
| 3   | Countries and setup screens                                    | In progress — waiting for World Bank data         |
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

## Phase 3 — Countries and setup screens (in progress)

Done:

- Main menu: New Game (Modern World — Recommended), the nine historical modes as locked "Coming soon" cards, Load Game (disabled until Phase 4), Settings. The feedback button stays hidden until there is a form link.
- New game setup (GDD section 3):
  - Step 1: AI aggressiveness (Peaceful / Realistic, the default / Aggressive / Chaos).
  - Step 2: country chosen on the map or from a searchable, sortable list. It shows the flag, GDP, population, army, allies, rivals, wars and 1–5 difficulty stars. Only full-status countries are selectable.
  - Step 3: leader name, showing who the player replaces, plus a summary.
- Disputed territories setting (Neutral / As states / As part of parent state). It changes the game data at load time (`src/sim/world.ts`), not just the map. It sits on the country step, because it decides which countries are playable, and is also a default in ⚙.
- Starting a game (`src/sim/newGame.ts`) creates the game state, replaces only the player's leader, and shows a top bar (flag, country, leader, date) with the player's country in signature amber with a glowing border. Main menu asks for confirmation before leaving the game.
- Difficulty stars (`src/sim/difficulty.ts`) are computed from data only. Factors: power (GDP, military spending, manpower), GDP per capita, stability (WGI), allies vs rivals, and active wars. Stars are spread by ranking (12/23/30/23/12 %).
- Data:
  - `leaders.json`: 203 leaders, 45 marked `verify`.
  - `diplomacy.json`: NATO, EU, CSTO, GCC, AES and 9 bilateral pacts; 33 rivalries, each with a reason; the Russia–Ukraine war (`verify`).
  - `scenario.json`: start date 2027-01-01 and the disputed territories with their parents.
  - `flags/`: 199 public-domain flags (hampusborgos/country-flags, pinned commit) plus 5 simplified disputed-territory flags and a black neutral flag (`npm run data:flags`).
- Translations: leader titles, alliances, the self-used names of disputed territories, and all new screens in English and Serbian.
- Validation covers leaders, flags, diplomacy references, the scenario and stat ranges.

Blocked:

- `npm run data:stats` (GDP, population, armed forces, military spending, political stability) needs network access to `api.worldbank.org` and `www.imf.org` (the IMF covers Taiwan). Until then the setup shows n/a and the difficulty stars are not meaningful.

## Next

- Dario: allow `api.worldbank.org` and `www.imf.org` in the environment's network settings. Then run `npm run data:stats`, tune the stars (USA ≈ 1, Montenegro ≈ 5), review, commit and open the PR.
- Dario: review `leaders.json` (45 `verify` entries) and `diplomacy.json`.

## Known issues

- Leaders and wars are drafted from information known up to mid-2026. Elections and events before the start date need a check.
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

# PROGRESS

Live game: https://rodrigomigl54-png.github.io/Modern-Leader-ML-/

## Phases (GDD section 16)

| #   | Phase                                                          | Status                                            |
| --- | -------------------------------------------------------------- | ------------------------------------------------- |
| 0   | Project setup                                                  | Done (live on GitHub Pages)                       |
| 1   | Map data pipeline                                              | Done in code — waiting for review |
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

## Next

- Dario: review the PR and merge.
- Then Phase 2 — map rendering (Prompt 2 in GDD section 17).

## Known issues

- Province names come from Natural Earth's `name` field (local romanization; some are dated, e.g. "Kiev City", "L'viv"). They need a review before release.
- Disputed territories use short names for now. The self-used names (GDD section 4, Neutral mode) belong to Phase 3.
- Generated cities have population 0 until Phase 3 data.
- 55 coastal provinces have no port: no city within 50 km of the sea.
- Phase 2 must not upload the full 16384 × 10559 ID map to a phone GPU at full resolution (~690 MB as RGBA). Load tiles by zoom, or use a downscaled copy for the zoomed-out view. 408 provinces are under 10 px, so they need a minimum tap target.
- Sea routes are a nearest-port graph and will be refined in Phase 7.

# tools

Data preprocessing scripts. Their output is committed under `data/`, so the game never needs the raw data.
The scripts are TypeScript run directly by Node 22 (type stripping); no build step.

## Map data pipeline (Phase 1)

```sh
npm run data:download   # Natural Earth GeoJSON -> tools/.cache/ (not committed)
npm run data:build      # -> data/modern/ (about a minute, needs ~2 GB RAM)
npm run data:validate   # checks + file size report (also part of npm test)
```

All decisions live in `tools/map/config.json`, not in code: Natural Earth version, raster size,
who owns which Natural Earth unit, breakaway territories, capitals and sea-route settings.

### Source

[Natural Earth](https://www.naturalearthdata.com) 1:10m, public domain, pinned to release `v5.1.2`
of [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector):
admin-0 countries, admin-1 states/provinces, admin-0 disputed areas, populated places.

### Outputs (`data/modern/`)

| File                         | Content                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provinces.json`             | One province per admin-1 region (none merged): id, key (Natural Earth `adm1_code`), name, owner, centroid (map pixels), lonLat, areaKm2, neighbors, isCoastal, pixels, bbox                              |
| `countries.json`             | id, nameKey (`country.<id>`, names in `src/i18n/countries.*.json`), status, capitalProvinceId, provinceIds                                                                                               |
| `cities.json`                | id, name, provinceId, population, isCapital, isPort, lonLat, position (map pixels); `generated: true` for cities created at a province centroid                                                          |
| `sea-routes.json`            | Draft graph of sea routes between port cities, with sea distance in km                                                                                                                                   |
| `map/tiles/L<n>/<x>-<y>.png` | Province ID map as a tile pyramid of 1024 px PNG tiles: level 0 is full resolution, each further level halves it. Color = province id + 1 as `R + 256 * G`; black = water, blue `#0000ff` = unowned land |
| `map/province-map.json`      | Map size, projection, levels and their tiles, encoding, color → province id lookup                                                                                                                       |
| `map/borders.json`           | Border polylines per pair of provinces (or province and water), traced from the ID map                                                                                                                   |
| `map/build-report.json`      | Counts, capitals, every ownership decision, overlaps and warnings from the last build                                                                                                                    |

### Projection

Miller cylindrical, 16384 px wide, from 84° N to 85° S. Its shapes look like the familiar Mercator
world map at middle latitudes, but the poles do not blow up. It is cylindrical, so east-west
panning can wrap around later, and pixel → lon/lat is a simple formula. Antarctica stays on the
map as a neutral, uninhabited territory.

### How the pipeline works

1. Every admin-1 region becomes a province. Its owner comes from its admin-0 unit: sovereign states map to
   their ISO code, and dependencies go to their sovereign (Greenland → Denmark, Hong Kong → China, …).
   Special cases are listed in `owners.overrides`.
2. Breakaway territories without their own admin-1 region (Abkhazia, South Ossetia, Transnistria) are carved
   out using Natural Earth's disputed-area polygons. A region almost fully inside moves whole; a region
   partly inside is split into two provinces.
3. Provinces are rasterized into the ID map. Provinces smaller than one pixel get one pixel at their label
   point, so every province can be seen and tapped.
4. Neighbors come from touching pixels, plus shared boundary vertices for borders thinner than a pixel.
5. A coarse water grid finds the navigable seas: the world ocean and the Caspian. The Suez and Panama
   canals, the Bosphorus and the Dardanelles are forced open. A province is coastal if it touches that
   water.
6. Cities are placed in provinces by point-in-polygon. Provinces without a city get one at their centroid.
   A city within 15 km of the sea in a coastal province is a port. A coastal province with no such city
   gets its closest city (up to 50 km) as port.
7. Sea routes connect ports whose nearest-port sea areas touch, following the water.
8. Borders are traced from the ID map, so they match it exactly, and simplified.

## Country statistics and debt

- `npm run data:stats` builds `data/modern/country-stats.json` from the World Bank API (GDP, population, armed forces, military spending, political stability) with the IMF for economies the World Bank lacks; gaps and `override: true` entries come from `tools/countries/estimates.json`.
- `npm run data:debt` builds `data/modern/debt.json` from the IMF WEO series `GGXWDG_NGDP`.
- Both need `api.worldbank.org` and `www.imf.org`; behind a proxy run them with `NODE_USE_ENV_PROXY=1`.

## AI profiles

`npm run data:profiles` builds `data/modern/ai-profiles.json` (GDD section 11) from the hand-written profiles in `tools/ai/manual-profiles.json` and, for every other country, scores derived from the game data (alliances, rivalries, wars, sanctions, SIPRI spending, mandatory service, nuclear weapons). Every score has a one-line justification. Edit the manual file and rerun; never edit the generated file by hand.

## Balance simulations

`npm run sim:balance` plays the Modern World with AI countries only (the player's country, Iceland
by default, gives no orders) for several years on every aggressiveness level and prints one line of
world statistics per year: wars, conquests, revolutions, secessions, nuclear strikes, sanctions,
median GDP growth, inflation and debt crises, median support, soldiers, milliseconds per turn and
save size, plus the notable events of the year. It uses the game's own code (through Vite) and the
same data as the browser.

Options: `--years 10`, `--levels peaceful,realistic,aggressive,chaos`, `--seed 1`, `--player ISL`,
`--watch RUS,UKR` (yearly economy and army lines for these countries), `--trace 229-260` (weekly
army lines for the watched countries between two turns) and `--out file.json`.

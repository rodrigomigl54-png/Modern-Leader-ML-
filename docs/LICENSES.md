# Licenses and rights inventory

Master plan, section 9. A working inventory for the release review, **not legal advice**.
"Checked" means an automated or documentary check in this repository; anything marked
**Needs review** must be confirmed by a person (ideally with legal advice) before a public
release on a store.

## Code libraries (shipped in the game)

| Item                  | Source                           | License     | Commercial use | Attribution                                                | Notes                                          |
| --------------------- | -------------------------------- | ----------- | -------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| PixiJS 8              | npm `pixi.js`                    | MIT         | Yes            | Keep the license notice                                    | Checked in `node_modules/pixi.js/package.json` |
| Inter (variable font) | npm `@fontsource-variable/inter` | SIL OFL 1.1 | Yes            | Keep the license with the font; do not sell the font alone | Checked in its `package.json`                  |

Build and test tools (Vite, TypeScript, Vitest, ESLint, Prettier, pngjs, polygon-clipping) are
not shipped in the game. A full list with licenses can be produced with
`npx license-checker --production` before a release.

## Map and geography

| Item                                       | Source                                             | License                       | Commercial use | Attribution                | Notes                                      |
| ------------------------------------------ | -------------------------------------------------- | ----------------------------- | -------------- | -------------------------- | ------------------------------------------ |
| Countries, provinces, cities               | Natural Earth 1:10m v5.1.2                         | Public domain                 | Yes            | Not required (appreciated) | `tools/README.md`                          |
| Sea routes, province names, disputed areas | Derived from Natural Earth by the game's own tools | Public domain base + own work | Yes            | —                          | Some province names were corrected by hand |

## Data

| Item                                                                                | Source                                                                              | License                   | Commercial use   | Attribution                        | Notes                                                                                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------- | ---------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GDP, population, armed forces, stability                                            | World Bank Open Data (API)                                                          | CC BY 4.0                 | Yes              | **Required**: "Source: World Bank" | **Needs work**: no attribution in the game yet (add a Credits line before release)                                                          |
| Government debt, GDP gaps                                                           | IMF World Economic Outlook                                                          | IMF terms of use          | **Needs review** | Required (cite the IMF)            | IMF data are generally free to use with citation; confirm the commercial terms                                                              |
| Military spending                                                                   | SIPRI Military Expenditure Database (via the World Bank series and the AI profiles) | SIPRI terms               | **Needs review** | Required (cite SIPRI)              | Used for upkeep calibration and AI profiles                                                                                                 |
| Leaders, alliances, wars, rivalries, nuclear arsenals, mandatory service, resources | Public information compiled by hand (`data/modern/*.json`, each with `meta.source`) | Facts (not copyrightable) | Yes              | —                                  | Values are game estimates                                                                                                                   |
| Real leaders' names                                                                 | Public information                                                                  | —                         | **Needs review** | —                                  | Names of living people in a commercial game: personality and publicity rights differ by country; store policies (see `STORE-CHECKLISTS.md`) |

## Images, icons, logo, intro

| Item                                                                               | Source                                                                     | License                                 | Commercial use                   | Notes                                                                                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Country flags (199)                                                                | `hampusborgos/country-flags` (pinned commit), files from Wikimedia Commons | Public domain (as stated by the source) | **Needs review** for a few flags | Some national flags and emblems are protected by national law even when public domain; spot-check before a store release |
| Disputed-territory and neutral flags (6)                                           | Drawn for this game (simplified)                                           | Own work                                | Yes                              |                                                                                                                          |
| Logo (ML monogram), intro, all UI icons (diplomacy, buildings, events, technology) | Drawn in code for this game                                                | Own work                                | Yes                              | Made with AI assistance (see below)                                                                                      |
| Map tiles                                                                          | Rendered by the game's tools from Natural Earth                            | Public domain base + own work           | Yes                              |                                                                                                                          |

## Sound and music

| Item                           | Source                                                              | License  | Notes                         |
| ------------------------------ | ------------------------------------------------------------------- | -------- | ----------------------------- |
| All sounds and the music track | Synthesized at run time with the Web Audio API (`src/app/sound.ts`) | Own work | The game ships no audio files |

## AI-generated content

The game's code, texts (UI, Academy, events), SVG icons, logo and intro were written with the help
of an AI assistant (Claude). No AI image generator was used and no third-party artwork was
imported. Steam asks developers to disclose AI-generated content in the Content Survey (see
`STORE-CHECKLISTS.md`).

## Trademarks

- "Age of History" / "Age of Civilizations" are only named as inspiration in the design
  documents; no assets, code, text or interface elements were copied. Do not use their names in
  store pages or marketing.
- Real organizations appear by name (NATO, European Union, United Nations): names only, no logos.
- **Needs review**: the name "Modern Leader" itself (search the trademark registers of the target
  markets before a store release).

## Before a public release

1. Add a Credits screen: World Bank (CC BY 4.0), IMF, SIPRI, Natural Earth, PixiJS (MIT), Inter (OFL).
2. Resolve every **Needs review** row above.
3. Run a license scan of the production dependencies.

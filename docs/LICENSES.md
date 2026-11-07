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

## Audit of November 2026 (Dario: "nothing may break any rule")

Done in this repository:

- **Libraries:** all 13 shipped packages are permissive: MIT (pixi.js and 8 of its packages),
  BSD-3-Clause (2), ISC (earcut), OFL-1.1 (Inter). The build now writes
  `THIRD-PARTY-LICENSES.md` next to the game with every license text (MIT, BSD and ISC require
  the notice in every copy). Linked from Settings → Credits and licenses.
- **Credits:** Settings → Credits and licenses names Natural Earth, the World Bank (CC BY 4.0),
  WGI, IISS, the IMF, SIPRI, the flags, Inter and PixiJS (CC BY 4.0 requires the attribution).
- **Files:** the game ships no third-party images, sounds, music or fonts other than the 199
  flags and Inter. Sounds are synthesized; icons, logo and intro are drawn in code. The 240
  PNGs are map tiles rendered from Natural Earth.
- **Other games:** no text the player sees names another game; no assets, code or texts come
  from one. Code comments mention Age of History as inspiration only.
- **Flags:** the source repository states the flags are public domain (from Wikimedia Commons);
  a list of flags with special licenses (oxguy3/flags) contains only US city flags, none of ours.

Findings that need a decision (see the chat report):

1. **SIPRI** (military spending, nuclear forces): SIPRI's terms allow free non-commercial use;
   commercial use needs permission and normally a royalty. The World Bank series
   MS.MIL.XPND.CD is SIPRI data and says its use is subject to SIPRI's terms. **Before a
   commercial release:** ask SIPRI for permission, or replace these values with the game's own
   rounded estimates from several public sources.
2. **IMF** (government debt): the IMF page asks for permission for commercial reuse
   (copyright@imf.org). Same choice: ask, or use the World Bank's own CC BY debt series where it
   exists and estimates elsewhere.
3. **IISS** (armed forces personnel, via World Bank MS.MIL.TOTL.P1): third-party data in the
   World Bank set; check the series' license note and ask IISS if needed.
4. **Real living leaders by name:** publicity and personality rights differ by country; the
   safest store version uses titles only ("President of France") or lets the player turn names
   on. Decision for Dario.
5. **The war in Ukraine at the start:** Google Play's Sensitive Events policy bars apps that
   capitalize on ongoing conflicts (a Hong Kong protest game was removed in 2019). A store build
   should present it as a neutral simulation and avoid using the real war in marketing; an
   option to start without current wars lowers the risk. Decision for Dario.
6. **Apple 1.1.2:** enemies in a game cannot solely target a real government. Met today (the
   player picks any country and fights anyone), keep it that way.
7. **Steam:** no ads that players must watch and no rewards for watching ads; AI-generated
   content must be disclosed in the Content Survey.
8. **Web ads:** Google's H5 Games Ads (AdSense) is an invite-only beta; ads need a privacy
   policy and, for players in the EU/EEA, a certified consent banner.
9. **Name "Modern Leader":** a quick web search found no game with that name or registered mark;
   a proper search in the USPTO, EUIPO, WIPO and Serbian registers is still needed.
10. **Patents:** no known patent covers the game's mechanics (turn-based map strategy is old and
    common); a formal freedom-to-operate search would need a patent attorney.

## Decisions of November 2026 (done)

- SIPRI, IISS and IMF values replaced by the game's own coarse estimates (findings 1–3 above
  resolved); nuclear forces are round public numbers.
- Real leaders' names removed: offices only (finding 4 resolved).
- No war at the start (finding 5 lowered): rivals at −100 instead.

## Before a public release

1. Add a Credits screen: World Bank (CC BY 4.0), IMF, SIPRI, Natural Earth, PixiJS (MIT), Inter (OFL).
2. Resolve every **Needs review** row above.
3. Run a license scan of the production dependencies.

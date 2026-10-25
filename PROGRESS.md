# PROGRESS

Live game: https://rodrigomigl54-png.github.io/Modern-Leader-ML-/

## Phases (GDD section 16)

| #   | Phase                                                          | Status                                            |
| --- | -------------------------------------------------------------- | ------------------------------------------------- |
| 0   | Project setup                                                  | Done (live on GitHub Pages)                       |
| 1   | Map data pipeline                                              | Done in code — waiting for review                 |
| 2   | Map rendering                                                  | Done (checked on the phone: smooth, up to 50 fps) |
| 3   | Countries and setup screens                                    | Done                                              |
| 4   | Turn engine and saves                                          | Done                                              |
| 5   | Economy                                                        | Done                                              |
| 6   | Population                                                     | Done                                              |
| 7   | Military                                                       | Done                                              |
| 8   | Missiles, drones, air defense, nuclear                         | Done                                              |
| 9   | Diplomacy                                                      | Done                                              |
| 10  | Resources and trade                                            | Done in code — waiting for the check on the phone |
| 11  | AI                                                             | Done in code — waiting for the check on the phone |
| 12  | Summits, events, notifications, reports, news, advisors, goals | Done in code — waiting for the check on the phone |
| 13  | Balance, polish, demo release                                  | Done (release on hold until the game is finished) |
| 14  | Complete the Modern World (Dario's choice after the demo)      | Done                                              |
| 15  | Complete the Modern World, part 2                              | Done in code — waiting for the check on the phone |

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

## Phase 5 — Economy

Done:

- Rules in `data/modern/economy.json`: starting values, limits, growth, debt, inflation, money printing and the 10 investment categories (cost, build time, GDP effect, upkeep). Nothing is hard-coded.
- Simulation (`src/sim/economy.ts`), the same rules for every country:
  - Weekly budget: taxes and returns from investments abroad as income; military (SIPRI share of GDP), public services, debt interest and building upkeep as spending. Deficits the treasury cannot cover become debt.
  - GDP growth from taxes, services, inflation and debt.
  - Inflation moves toward a target driven by printed money, large deficits and overspending. It erodes the real value of the treasury. The Minister of Finance warns once it passes 10 %.
  - Construction (turn step 5): finished buildings add GDP to the host country.
- Commands (`src/sim/commands.ts`):
  - `setTax`, `setServices`.
  - `printMoney`: instant cash of 1 % of GDP; inflation rises; asks for confirmation.
  - `invest`: one or many cities, own or foreign. The host's consent is refused between rivals or countries at war. Returns from a country at war are frozen.
- UI:
  - Top bar with treasury, GDP and inflation. Tap it to open the Ministry of Finance panel: budget lines, tax and services sliders, money printing and the project list.
  - City "+" select in the province panel. A selection bar counts the selected cities.
  - Invest dialog: category, total cost, build time, expected GDP/returns and refusing hosts, then confirm.
  - Toasts when a building finishes; a telegram from the Minister of Finance.
- Saves from Phase 4 still load (the economy is added on load).
- A year of all 204 countries on real data: GDP grows about 2 % with about 2 % inflation, and Ukraine's war spending pushes it into debt and about 10 % inflation. One turn takes about 3 ms.
- Checked in Chromium with phone emulation: print money, invest in a factory in Kragujevac, finished after 12 turns. No console errors.

## Phase 6 — Population

Done:

- Rules in `data/modern/population.json`: support effects, riot and revolution thresholds, rebel advance, secession time and assimilation costs.
- Simulation (`src/sim/population.ts`, turn step 7), the same rules for every country:
  - Public support (0–100 %) per province; national support is the population-weighted average. Each province moves toward a target set by GDP growth, public services, inflation, taxes, debt, finished buildings in the province, unassimilated people and nearby rebels.
  - Riots below 30 %: production (tax income) drops in rioting provinces.
  - Revolution: when national support is below 30 % and riots have lasted 6 weeks in at least 15 % of the population, a rebel faction rises in the angriest provinces (up to a quarter of the country; never the capital) and is at war with the government.
  - Until armies exist (Phase 7), rebels advance while national support is below 40 % and retreat while it is above 50 %.
  - Crushed revolution: GDP loss and new debt. Rebels taking the whole country: game over for the player, a new government for an AI country. Rebels holding land for 52 weeks: it becomes a new country.
  - Conquered provinces keep their culture: lower production and support until assimilated. `assimilate` command: cost by population and cultural distance (cheaper for allies, dearer for rivals), 26 weeks, lower support while it runs.
- UI:
  - Support in the top bar (red below 30 %). Tap it for the Ministry of the Interior: national support, production, rioting provinces (tap to open on the map), the revolution and weeks to secession, conquered land with "Assimilate all" (asks first with the total cost and the risk).
  - Map mode switch (bottom left): Political and Support (red–grey–green, rebel land dark red).
  - Province panel: support, riots, people of another culture, assimilation progress and an Assimilate button.
  - Telegrams from the Minister of the Interior (riots, revolution, crushed, secession); toasts for revolutions abroad; game-over screen.
  - Rebels and new countries are named "Rebels of Serbia" / "Free {province}" in both languages.
- Saves from Phase 5 still load (the population is added on load).
- Two years of all countries on real data with no player action: the world stays calm (median support about 64 %); Ukraine falls to about 31 % because of war spending and inflation.
- Checked in Chromium with phone emulation as Serbia with maximum taxes: riots after 25 weeks, revolution after 30, and the rebels slowly take the country. No console errors.

## Phase 7 — Military

Movement works as in Age of History 2 (Dario's choice): armies stand in provinces, get a destination and move one province per turn; entering an undefended enemy province takes it, a defended one means a battle.

Done:

- Rules in `data/modern/military.json`; mandatory service at the start in `data/modern/military-service.json` (drafted, entries to check listed in `verify`).
- Simulation (`src/sim/military.ts`), the same rules for every country:
  - Starting army from real personnel: 40 % in the capital, the rest in the most populous provinces. Reserves from personnel (more with service), spread by population. Bases: level 2 in the capital, level 1 in the 3 largest cities.
  - Upkeep per soldier is calibrated so the starting army costs the real (SIPRI) military spending; the budget's military line is now the cost of the soldiers.
  - Recruitment (`recruit`): many cities at once, a fixed number per city (takes what is available) or a percentage of each city's manpower; base level caps recruits per turn; special forces (2.5×) only at level 2+ bases. Training 4 weeks (special 12); trainees defend their city.
  - Manpower per city refills slowly; with service the reserves grow, without it they shrink. Introducing service costs support (`setService`).
  - Movement (turn step 3): shortest path over land and sea routes, respecting the borders rule (own, allied or enemy land only). Sea crossings take one turn per 1,200 km.
  - Battles (step 4): strength, numbers, defender bonus, base level, supply and a little randomness. The loser retreats or is destroyed; reservists defend only provinces with a base. Captured provinces keep their culture (assimilation). A country that loses its last province is conquered; for the player that is game over.
  - `moveArmies`, `splitArmy`, `declareWar` (simple until diplomacy).
  - Revolutions now raise rebel armies; support decides how many join or desert them.
- Simple AI (`src/sim/ai.ts`) for countries at war: recruits toward the army it can pay for (at most a quarter of the treasury per turn), covers the front according to the enemy next to it, attacks weak neighboring provinces, keeps the capital garrison.
- UI:
  - Army counters on the map (own amber, enemy red, allies blue, others grey when zoomed in) with dashed routes for moving armies.
  - Province panel: base, reservists, armies with + select and Split, "Move here" / "Attack" for the selected armies, "Declare war" (asks first).
  - Selection bar: Recruit next to Invest for selected cities; selected armies count.
  - Recruit dialog: unit, number per city or % of manpower, recruits, cost, training time, cities short of people.
  - Army in the top bar opens the Ministry of Defence: soldiers, reservists, manpower, cost, mandatory service, wars, all armies (tap to open the province).
  - Weekly war summary toasts, Minister of Defence telegram when provinces are lost, game-over screen when conquered.
- Saves from Phase 6 still load (the military is added on load).
- Two years on real data: the Russia–Ukraine front moves back and forth without collapse; a turn takes about 16 ms.
- Checked in Chromium with phone emulation as Serbia: declared war on Bosnia, sent the Belgrade army to Tuzla (taken via Bijeljina), recruited in Belgrade. No console errors.

## Phase 8 — Missiles, drones, air defense, nuclear

Done:

- Rules in `data/modern/weapons.json`: 4 missile tiers (range 300–13,000 km; tiers 3–4 hit 2–3 cities), 3 drone tiers (range in provinces), air defense levels 1–3 (radius, interception rate, capacity per turn, cost), production, starting arsenals, nuclear rules and nuclear forces (9 countries; SIPRI 2025 warheads rounded; base cities approximate).
- Simulation (`src/sim/weapons.ts`), the same rules for every country:
  - Starting arsenals from military spending, limited by each country's tech level; air defense in the capital and largest cities by spending; weapons factories by spending.
  - Missiles (`launchMissiles`) fly from the nearest own military base in range and hit next turn (turn step 2): they kill soldiers, destroy buildings, lower bases and air defense, can destroy nuclear bases, cut GDP and support. They never capture.
  - Drones (`launchDrones`) fly one province per turn along a legal route and strike where they arrive; enemy air defense shoots at them on the way.
  - Air defense of the defender and its allies intercepts within its radius, up to its capacity per turn, so volume overwhelms it. `buildAirDefense` builds or upgrades a city (needs an air-defense factory).
  - `produceWeapons` orders missiles or drones from finished factories (time from factory count and tier weight).
  - Nuclear weapons (`launchNuclear`) launch only from an active base (a captured or destroyed base no longer launches), cannot be intercepted and devastate the province. The user loses a lot of support and GDP and grows more slowly as a pariah (sanctions arrive in Phase 9). `startNuclearProgram`: 30 bn, about 5 years, then 5 warheads and a base in the capital.
  - The AI at war fires a share of its missiles and drones at enemy armies near the front or the enemy capital, produces missiles, and uses nuclear weapons only as a last resort (country almost lost, enemy at the capital).
- UI:
  - Enemy province: "Missile or drone strike" opens the strike dialog (weapon, tier with range and stock, count, air defense at the target). Nuclear strike with consequences and a second confirmation.
  - Own province: air-defense level, nuclear base, "Air defense here · cost".
  - Ministry of Defence: arsenal by tier, air defense, factories, warheads and bases, production orders, nuclear program.
  - Map: missile arcs with a timer badge, drones as chevrons along their route, nuclear bases visible to everyone, impact ripples, and an Air defense map mode with coverage and radius rings. The map mode switch is now one button with a list.
  - Strike summary toasts, Minister of Defence telegrams for enemy strikes and nuclear use.
- Saves from Phase 7 still load (weapons are added on load).
- Two years on real data: missiles and drones are used every week (about 700 strikes) without wiping out armies; the Russia–Ukraine front stays stable; a turn takes about 21 ms.
- Checked in Chromium with phone emulation as Serbia: war with Bosnia, 2 missiles on Tuzla (20 soldiers killed), arsenal, production dialog, air-defense map. No console errors.

## Phase 9 — Diplomacy

Done:

- Rules in `data/modern/diplomacy-rules.json`; documented starting relations in `data/modern/relations.json` (51 pairs with a reason each; draft, needs review). Other pairs start from alliances (+60), pacts (+50), rivalries (−60) and wars (−100).
- Simulation (`src/sim/diplomacy.ts`, turn step 8), the same rules for every country. Until AI profiles (Phase 11), AI answers follow thresholds in the rules file:
  - Relations −100..+100 for every pair; actions change them and they drift back slowly toward what alliances and rivalries imply.
  - Diplomatic points per week from size and credibility, capped at three weeks; costs from GDD section 5 (ultimatum 3, sanction 2, alliance 4, base 3, vassal 4, aid 1). Countries start with full points.
  - Alliances and pacts: propose a pact, ask to join an alliance (members must be friendly), leave. When a country is attacked, its alliance and pact members decide whether to join by their relations; vassals and overlords always do; the player's allies are asked.
  - Sanctions: slow the target's growth by the sanctioning share of the world economy, lower its support, block investment and weapons trade, freeze investment returns, and push the target toward the sender's rivals.
  - Ultimatums (province, leaving an alliance, lifting sanctions, tribute, vassal, base; threat war, sanctions or leaving the alliance; 3-week deadline). The AI weighs the threat (power and credibility) against the demand. A refused ultimatum must be carried out within 4 weeks or the sender loses credibility.
  - Foreign bases (ask or pay): a launch site for missiles and drones, and the right to move armies through the host. They close when relations break down.
  - Aid (money and/or weapons), weapons trade (buy and sell; blocked by sanctions; nobody sells to the enemies of its friends).
  - Vassals: ask, offer, transfer, release; vassals pay tribute and follow their overlord in war.
  - War score from captured provinces, battles and strikes; peace terms (keep provinces, get ours back, reparations, vassal, demilitarized border) cost war score, war weariness helps. AI countries make peace after a decisive result or a long stalemate and offer peace to the player.
  - Nuclear use now brings real global sanctions (replaces the growth penalty of Phase 8).
- UI:
  - Diplomacy points in the top bar open the Ministry of Foreign Affairs: points, credibility, requests to answer, wars with score and peace talks, alliances (leave), vassals, sanctions, bases, our ultimatums.
  - "Diplomacy: {country}" in the province panel opens the country dialog: relation bar, credibility, alliances, and every action with its cost (pact, join alliance, ultimatum, base, aid, trade, vassal, sanctions, war, peace talks).
  - Declaring war warns which allies may join; a telegram lists those who did.
  - Requests (join a war, peace offers) arrive as questions from the Minister of Foreign Affairs.
  - Map modes: Relations (green to red toward the player) and Alliances.
- Saves from Phase 8 still load (diplomacy is added on load).
- Two years on real data: a turn takes about 28 ms; the Russia–Ukraine war ended in a negotiated peace in the first year.
- Checked in Chromium with phone emulation as Serbia: Croatia refused a pact; declaring war on Croatia brought 30 NATO members into the war; peace with Croatia; relations map. No console errors.

## Phase 10 — Resources and trade

Done:

- Data in `data/modern/resources.json`: oil, gas, food, rare metals and chips, as rounded world shares of production and consumption (Energy Institute / EIA, FAOSTAT, USGS, SIA / SEMI; draft, spot checks pending). Food uses self-sufficiency ratios. World trade values set the prices.
- Sanctions in force at the start are now in `data/modern/relations.json` (187 entries: on Russia, Belarus, Iran, North Korea, Cuba, Venezuela, Myanmar, each with its reason).
- Simulation (`src/sim/resources.ts`, turn step 6 before the budget), the same rules for every country:
  - Production sits in provinces (by population), so conquest moves it; finished agriculture adds food, energy adds oil and gas.
  - Consumption grows with each economy relative to the world.
  - A world market per resource: exporters sell their surplus, importers buy what they lack. Sanctions and wars block trade between the countries involved; half of the blocked trade can be rerouted through third countries. The effect depends on how much a country depends on the blocked partners.
  - Export revenue: the treasury gets 15% (new budget line). Shortages cost GDP each year by the resource's weight; food shortages lower support; below half of the needed chips, missile and drone factories stop.
  - The Minister of Finance warns about shortages.
- UI: resources table in the Ministry of Finance (production, needs, supply, export value); Resources map mode (main export of each country) with a legend.
- Fixed: the map background below Antarctica was white when zoomed out (wrong color format).
- Saves from Phase 9 still load (resources are added on load).
- Two years on real data: a turn takes about 32 ms. Russia exports about 390 bn a year under sanctions (500 bn without) and gets 79% of the chips it needs; Germany is a little short of oil and gas.
- Checked in Chromium with phone emulation as Russia: economy panel with resources, resources map. No console errors.

## Phase 11 — AI behavior profiles

Done:

- Profiles in `data/modern/ai-profiles.json` for all 203 inhabited countries, built by `npm run data:profiles` (`tools/ai/build-profiles.ts`): 40 hand-written profiles (`tools/ai/manual-profiles.json`: United States, China, Russia, the UK, France, Germany, Japan, India, Pakistan, Israel, Iran, North Korea, South Korea, Turkey, Saudi Arabia, Ukraine, Poland, Belarus, Serbia, Hungary, Azerbaijan, Armenia, Taiwan, Egypt, the UAE, Venezuela, Cuba, Brazil, Australia, Canada, Italy, Spain, Vietnam, Indonesia, South Africa, Nigeria, Mexico, Argentina, Ethiopia, Kazakhstan); the rest derived from data. Every trait has a one-line justification from documented behavior; partners and rivals listed. Draft — needs Dario's review.
- Rules in `data/modern/ai-rules.json`: chances per turn, thresholds, aggressiveness multipliers (Peaceful ×0.5, Realistic ×1, Aggressive ×1.5 on hostile traits; Chaos at the maximum with random timing).
- Simulation (`src/sim/profiles.ts`, `src/sim/aiPolicy.ts`, turn step 1), for every AI country, by its traits:
  - Budget: closes deficits when debt is high, lowers taxes when the people are angry.
  - Economic focus: invests at home; friendly countries offer to invest in the player's cities (the player accepts or refuses).
  - Sanctions on hostile rivals; ultimatums to much weaker hostile neighbors (tribute, a province for expansionists, lifting sanctions), and carries out the threat when it dares — or loses credibility.
  - Rare wars of expansion against much weaker hostile neighbors (expansionism × risk tolerance).
  - Interventionism: joins partners' wars (needs high relations and risk tolerance, much more against nuclear powers) or sends them aid; proposes pacts to partners.
  - Alliance loyalty decides how readily allies join a war.
  - Nuclear posture: losing nuclear powers threaten the player; last-resort use only above a minimum posture.
- Aid now raises relations more gently (it made partners' relations climb too fast).
- UI: "AI profile" in the country dialog (traits with bars and justifications, partners, rivals); telegrams when a country declares war on us or attacks an ally, nuclear threats; toasts for other wars and sanctions on us; questions for AI ultimatums and investment offers.
- Two years on real data: Peaceful no new wars, Realistic one (Pakistan–Afghanistan, late), Aggressive one early, Chaos several (Cyprus, Georgia, Morocco…). A turn takes about 53 ms.
- Checked in Chromium with phone emulation as Serbia: Croatia's profile; ten turns without errors.

## Phase 12 — Summits, events, reports, news, advisors, goals

Done:

- Summits (`data/modern/summits.json`, `src/sim/summits.ts`, turn step 9): a regular summit every 52 turns from week 27, rotating UN General Assembly → G20 → regional summit (capitals within 2,500 km) → alliance summit (UN if the player has no alliance). Emergency summits after a war between two of the 15 largest economies, a nuclear threat or strike, or a revolution in a large country (at most one per 13 turns).
- Questions are templates filled with live data, most pressing first (2 at emergency summits, 3 at regular ones): our war or occupation, high inflation and an aid package, an accusation of arming a friend's war, joint sanctions on an aggressor, a no-first-use pledge, recognizing rebels, a trade agreement, a refugee crisis. Each has 3–4 answers that change relations (members, host, the country in question), support, credibility, money, or join sanctions; the effect is shown under each answer.
- Skipping (or not answering within 2 turns) lowers relations with every member and the host, costs credibility, and an aggressor that skips gets sanctions from the hostile members. `summit` command (answers or skip).
- News (`src/sim/chronicle.ts`): headlines for new wars and alliances, countries joining wars, peace, conquests, revolutions, secessions, nuclear strikes, sanctions and summits; the last 40 are kept in the save.
- General report every 10 turns: GDP change, treasury, weekly balance, debt, support change, wars started/ended, new sanctions and alliances in the world, the three biggest changes of relations with the player.
- Goals (`data/modern/goals.json`, `src/sim/goals.ts`): 4–5 goals chosen from the starting situation — grow GDP 15% in 5 years, no riots for 5 years, inflation under 5% for a year, stay in the current alliance / stay neutral (low loyalty) / join an alliance, and lower debt for indebted countries. Checked every turn; done/failed events.
- UI: wire-service news strip at the bottom (tap for all headlines with dates), report telegram, summit dialog with answers and the cost of skipping, goals panel with progress bars and deadlines (game menu: Goals, World news), toasts for achieved and failed goals and missed summits. The four ministers give a tip in each of the first five turns (economy, interior, defence, foreign affairs, goals) as the tutorial.
- Older saves get the news, summits and goals on load.
- Two years on real data as Serbia: UN Assembly in week 27 (hosted by the US) and a G20 summit in week 79 (hosted by China); reports every 10 turns; the inflation goal achieved after a year.
- Checked in Chromium with phone emulation as Serbia: the five ministers' tips, two reports, the UN Assembly (joint sanctions on Russia, trade, refugees) answered, the news strip and list, the goals panel; no errors.

## Phase 13 — Balance, polish, demo release

Part 1 — balance (done):

- `npm run sim:balance` (`tools/balance/simulate.ts`, described in `tools/README.md`): plays the Modern World with AI countries only for years on every aggressiveness level and prints world statistics per year, notable events, and yearly or weekly lines for watched countries. The game and the tool build the world with the same function (`assembleWorld` in `src/app/worldData.ts`).
- What the 10-year runs found and what changed:
  - At war the AI kept its whole army in the capital (Russia held ~800k soldiers in Moscow and sent ~190k to the front), so Ukraine took 65 Russian provinces in half a year and Russia collapsed into endless revolutions. Now the capital keeps 20% of the army (`military.json` `ai.capitalShare`) and the rest goes where the front needs it. The Russia–Ukraine war now usually ends in a stalemate peace after about two years.
  - Countries never demobilized after a war and ran deficits for years. At peace, an AI country in deficit now sends 1% of its regulars to the reserves each week until its army costs at most 5% of GDP (`ai.demobilizeShare`, `ai.peaceMilitaryShare`).
  - Angry people with money in the bank: the AI now first raises public services toward 20% of GDP, then lowers taxes (`ai-rules.json` `fiscal.targetServices`, `fiscal.reserveWeeks`). Ukraine kept services at 5% of GDP after the war and stayed near riots.
  - Sanctions cut growth too much (Russia lost 7% of GDP a year). Now at most 2.5% a year (`diplomacy-rules.json` `sanctions`).
- Result (seed 1–2, 10 years, a passive player): Peaceful 2–3 wars in 10 years, Realistic 6–8, Aggressive ~10, Chaos 2–3 a year; median growth about 2.2% a year; no country collapses outside wars except in Chaos. A passive Serbia keeps 64% support and grows 2.2% a year, so the GDP goal needs investment.
- Faster turns: the state is copied with a direct copy instead of `structuredClone` (most of it is long arrays of numbers), saving about a quarter of the turn time; a turn takes 50–70 ms on a PC.
- Checked in Chromium with phone emulation as Ukraine: 12 turns without errors.

Part 2 — polish and release build (done):

- Settings screen (corner button and both menus): language, theme (Night / Day), interface size (90–130%), music and sound-effect volumes, the default for disputed territories, the FPS counter, and "Send feedback". Choices are remembered on the device. Fixed: settings opened from the main menu appeared under it.
- Day theme (GDD section 13): warm map paper, light sea, ink borders; panels and dialogs in light colors. Night stays the default.
- Sound (`src/app/sound.ts`), synthesized with Web Audio, so there are no audio files and no licenses: UI clicks, an alert with every minister's telegram, missile/drone launch and impact sounds, and a calm ambient music track during a game. Muted by default on phones (turn it on in Settings); on a PC music 30%, effects 60%.
- Leader seals (GDD section 13): initials inside a geometric emblem in a color of the country — in the top bar (wider screens) and in the country dialog with the leader's title and name.
- Feedback: "Send feedback" opens a short GitHub form (`.github/ISSUE_TEMPLATE/feedback.yml`: what was fun, what was confusing, device, country and level). Testers need a GitHub account; the link is `FEEDBACK_URL` in `src/ui/settings.ts` if another form is preferred.
- itch.io package: `npm run build:itch` builds the game with relative paths into `dist-itch/` and zips it into `modern-leader-demo.zip` (about 5 MB). GitHub Actions builds the same zip on every push to `main` (artifact `modern-leader-demo-itch` on the run page). To publish: on itch.io create a new project, kind "HTML", upload the zip, tick "This file will be played in the browser", set the viewport (for example 1280×720) and enable "Mobile friendly" and "Fullscreen button".
- Checked in Chromium: the itch package served from another path, Day theme at 115% on a phone, a leader seal (Viktor Orbán), and the sounds on a PC (no errors).

## Phase 14 — Complete the Modern World

Dario chose to finish the Modern World mode before new modes or mechanics; nothing is published until the whole game is done.

Done:

- Support follows the course of wars (GDD section 7, `population.json` `support.war`): won battles +0.3, lost −0.5, taken provinces +1, lost −2 (at most ±5 a turn); a won peace (war score 15+) +8, a lost one −8. Skipping a summit costs 3 points of support at home. (Missile damage and introducing mandatory service already lowered it.)
- Naval crossings can be intercepted (GDD section 8): a convoy sailing to enemy land loses 3% of its soldiers per turn at sea, plus up to 20% × the interception rate of enemy air defense covering the landing city (`military.json` `naval`). Telegram-style toasts for our losses and for convoys we hit.
- The AI builds air defense: a country at war, or with a hostile country that has missiles, builds or upgrades air defense in its capital and largest cities when it costs at most 15% of its treasury (`weapons.json` `ai.airDefense`).
- Emergency summits also follow the player's own war declarations on a large power (found by the war's start turn).
- Three more summit questions: a ceasefire in a distant war, the player's nuclear program, a climate agreement (eleven templates).
- Peace with a whole side: when the leader of a side makes peace, its allies in that war make peace with the same country too, each keeping what it holds (no more separate peace with each NATO member). The peace screen says so.
- Vassals are drawn in a shade of their overlord's color on the political map.
- Every AI country has its own 3–5 goals (GDD section 13), checked every turn and shown in its country dialog.
- Fixed: AI demobilization ran twice a turn (now once, at the same 2% a week the balance runs used).
- A country that crushed a revolution gets 26 calm weeks before the next one (`population.json` `revolution.calmTurns`); Armenia had 25 revolutions in one year on Aggressive.
- 10-year runs on all levels after these changes: no collapses outside wars on Peaceful/Realistic; Russia–Ukraine ends in about two years; on Chaos a losing great power can still fall apart.
- Checked in Chromium with phone emulation: Hungary's goals in its country dialog, no errors.

## Phase 15 — Complete the Modern World, part 2

Done:

- AI countries follow their goals (GDD section 13, `ai-rules.json` `goals`): growing GDP invests 1.5× as often, joining an alliance proposes pacts 3× as often, staying neutral proposes none, lowering debt closes deficits from half the usual debt limit.
- Sanctions hurt by dependence (GDD section 6: "their effect depends on how much the target depends on the sanctioning country"): a gravity model of economic ties — another country's GDP divided by the distance between the capitals (`diplomacy-rules.json` `sanctions.dependence`). North Korea now loses 31% of its ties to sanctions instead of 54% (China is its lifeline), Cuba 60% instead of 26% (the US is next door). Over ten years Russia loses about 1.2% of GDP a year under sanctions, Iran about 0.5%.
- The country dialog shows the economic ties both ways (how much sanctions would cut).
- Shortages the player's country has from the very start get a Minister of Finance telegram after the first tip (for example Russia's chips).
- Checked in Chromium with phone emulation as Russia: ties line in a country dialog, no errors.

## Next

- Dario: merge the PR and check on the phone (a war: support and the summit; the peace screen with an alliance; a country dialog: goals).
- Fresh World Bank/IMF data when the network allows it, then rerun `npm run sim:balance`.
- Nothing is published (itch.io) until the whole game is finished.

## Known issues

- Map labels keep light text with a dark outline in the Day theme.
- The interface size uses CSS `zoom` (supported by current browsers; very old ones ignore it).

- Summit questions come from a fixed set of eleven templates.

- 163 of 203 AI profiles are derived from data rather than written by hand; their justifications are generic.
- A turn takes 50–70 ms on a PC; to watch on slow phones.
- In Chaos, a country at war can spiral (inflation and debt keep rising, endless rebels): the AI cannot fix its budget during a war.

- Resource shares are rounded estimates.
- Resource trade is a world market, not per-partner deals; prices are fixed.

- Peace with a side's leader ends the war with its allies; a member that is not the leader still makes a separate peace.

- Starting arsenals are estimated from military spending, not real inventories; nuclear base locations are approximate.

- The player's empty provinces fall to any enemy army, so garrisons matter.
- Mandatory service list and reserve sizes are drafted estimates; reservists without a base do not defend (as in the GDD).

- Province population is the sum of its Natural Earth cities, so provinces without a listed city weigh little.

- Debt starts at 0 for every country until IMF debt data can be loaded; trade income comes in Phase 10.
- Economy numbers are first design values; they are tuned in Phase 13.

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

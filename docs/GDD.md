# Modern Leader (ML) — Game Design Document

Oct 24, 2026 · @Dario

## 1. Overview and demo scope

Modern Leader (working title, code name ML) is a turn-based geopolitical grand-strategy game set in today's world: the player leads one real country and manages its economy, people, military and diplomacy against AI countries that behave like their real-world counterparts.

**What makes it different from Age of History 3:** AoH3 is mostly about conquest. ML gives equal weight to economy, public support, investment (into your own and foreign cities), sanctions, ultimatums, foreign bases and modern weapons (missiles, drones, air defense, nuclear deterrence).

**Demo scope:** one mode only, "Modern World" (recommended, first in the menu). The historical modes are shown in the menu as locked "Coming soon" cards: Peloponnesian War (431–404 BC), Punic Wars (264–146 BC), Thirty Years' War (1618–1648), War of the Spanish Succession (1701–1714), Seven Years' War (1756–1763), Napoleonic Wars (1803–1815), World War I (1914–1918), World War II (1939–1945), Cold War.

**Fixed decisions for the demo:**

- Turn-based; the button reads "Next Turn".
- Web build first (desktop and phone browsers), deployed to GitHub Pages.
- English is the main language; every UI string goes through a translation system from day one (Serbian added as the second language).
- Single player only. No multiplayer in the demo.
- No images of real leaders: names and titles only.
- Full province map, no merging or simplification.
- Later (not demo): Steam and mobile release, free with ads and in-app purchases. Monetization must never sell military or economic advantage (no pay-to-win).

## 2. Tech stack, architecture and workflow

The game is a pure web app: TypeScript + PixiJS, built with Vite, tested with Vitest, deployed automatically to GitHub Pages on every push to `main`.

| Part | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict mode) | Claude Code is strongest here; type errors caught before runtime |
| Rendering | PixiJS (WebGL) | Fast 2D, smooth on phone browsers with thousands of provinces |
| UI panels | Plain HTML/CSS over the map canvas | Menus, tables and dialogs are easier and more readable in HTML than in WebGL |
| Build | Vite | Fast, simple config, static output for GitHub Pages |
| Tests | Vitest | Simulation is tested without a browser |
| Map preprocessing | Node or Python scripts in `tools/` | Turn Natural Earth data into game files once; output is committed |
| Hosting | GitHub Pages via GitHub Actions | Free; one link that works on PC and phone |
| Saves | Browser IndexedDB, plus export/import of a save file | Works offline; the player can move a save between devices |

**Three layers, strictly separated:**

1. **Simulation core** (`src/sim/`): all rules (economy, combat, diplomacy, AI). Pure TypeScript, no PixiJS or DOM imports. Deterministic: same save + same seed = same result. This makes automated tests and AI balancing possible.
2. **Data** (`data/`): countries, provinces, cities, leaders, relations, alliances, AI profiles, buildings, weapons, prices. JSON, never hard-coded. Historical modes later = new data folders.
3. **Presentation** (`src/ui/`, `src/map/`): reads the simulation state and sends commands (`InvestCommand`, `MoveArmyCommand`, ...). It never changes the state directly.

**Working from PC and phone:** the GitHub repository is the single source of truth. Claude Code on the PC and Claude Code from the website or phone app both work on the same repo; every finished task ends with a commit and push. GitHub Pages rebuilds the game automatically, so the latest version is always at the same link. Rule: never work on the same task from two devices at once; finish and push first.

**Pro plan limits:** each prompt builds one system, ends with tests passing and a push. If a usage limit is hit mid-task, the next session continues from the last commit using `PROGRESS.md` (a file Claude Code keeps updated with what is done and what is next).

## 3. Game setup

A new game takes three choices: AI aggressiveness, country, and the player's leader name.

**Step 1 — AI aggressiveness** (one global setting; the AI's intelligence is the same at every level):

| Level | Effect on AI profiles (section 11) |
| --- | --- |
| Peaceful | Hostile traits halved; threats rarely turn into action |
| Realistic (default) | Profiles applied as they are |
| Aggressive | Hostile traits ×1.5; faster escalation from threats to sanctions to war |
| Chaos | Hostile traits at maximum; more unpredictable decisions |

**Step 2 — Country selection** on the whole world map: tap a country, check its card, confirm (a searchable list stays one tap away). Each country shows: flag, GDP, population, army size, allies, rivals and an **automatic difficulty rating (1–5 stars)**. Difficulty is computed from data, never set by hand or by the player: GDP per capita, total GDP, military strength, stability, number and strength of allies versus rivals, and active wars. Example: the United States ≈ 1 star, Montenegro ≈ 5 stars.

Only countries with full status are selectable (see section 4, disputed territories).

**Step 3 — Leader name.** The player types a name and replaces the current head of state/government of the chosen country. All other countries keep their real leaders (names and titles only).

Optional setting on this screen: **Disputed territories display** (section 4).

## 4. World, map and disputed territories

The world starts on a fixed date (default 1 January 2027, stored in data, changeable) with borders, leaders, alliances, wars and relations as they stand on that date.

**Map**

- Source: Natural Earth (public domain), admin-1 regions (states, provinces, oblasts). All regions are kept; none are merged.
- Each region = one province. Each province has one or more **cities** (the capital plus larger cities). Investments, bases, factories and buildings are placed in cities; combat and movement happen between provinces/cities.
- Rendering: a province ID bitmap (each province a unique colour) plus a shader that colours provinces by owner or by map mode. Province names appear only when zoomed in. This keeps thousands of provinces smooth on phones.
- Sea zones connect port cities for naval transport (section 8).

**Country status**

- **Full status:** every UN member state, plus Vatican City, Palestine and Taiwan. All are playable.
- **Disputed status (neutral, not playable):** Kosovo, Western Sahara, Northern Cyprus, Abkhazia, South Ossetia, Transnistria, Somaliland.

**Disputed territories setting** (chosen before the game):

| Option | Map | Name shown | Playable | Diplomacy |
| --- | --- | --- | --- | --- |
| Neutral (default) | Own territory, black flag | The name it uses for itself | No | Limited: cannot join alliances; fewer recognitions |
| As states | Own territory, own flag | Own name | Yes | Full |
| As part of parent state | Territory of the state it separated from | Parent state's name | No | None (part of parent) |

The setting changes game data at load time, not just the visuals.

## 5. Turn structure and action limits

One turn = one week (52 turns per year). The player issues any number of orders, limited by movement, diplomatic points, money and manpower, then presses "Next Turn".

**Turn resolution order** (same for player and AI):

1. AI countries decide and issue their orders.
2. Missiles launched last turn hit; damage is applied and reported.
3. Units move (armies and drones, one city per turn).
4. Battles are resolved.
5. Construction, training and assimilation progress.
6. Economy: income, spending, trade, inflation.
7. Population: support, unrest, revolt checks.
8. Diplomacy: ultimatum deadlines, alliance responses, sanctions take effect.
9. Events, summits, urgent notifications; the 10-turn report when due.
10. Autosave.

**Limits per turn:**

- **Movement:** armies and drones move one city per turn. Missiles hit on the next turn regardless of distance (example: launched from Athens, the London damage shows next turn).
- **Diplomatic points:** each country earns points per turn based on size and reputation; points cap at three turns' worth. Starting costs (to be tuned): ultimatum 3, sanction 2, alliance proposal 4, base request 3, vassal request 4, aid package 1.
- **Economy:** limited by money only. Buildings take several turns to complete.
- **Recruitment:** limited by available manpower and base capacity.

**Borders:** units may enter another country's territory only if the two countries are at war or are allies (alliance or pact). Any other move is blocked for the player and the AI.

## 6. Economy, investment, inflation, resources and trade

The economy runs on GDP, a national budget and city-level investment; every bad economic decision feeds into public support (section 7).

**Budget:** income from taxes (player sets the rate), trade and foreign investment returns. Spending on military upkeep, public services, investments, aid and debt interest. Deficits add to national debt.

**Investment** (into own cities or foreign cities):

1. Select one or many cities (multi-select).
2. Choose a category: factory, university, agriculture, infrastructure, energy, missile production, drone factory, air-defense production, military base, hospital.
3. See total cost, build time and expected effect; confirm.

Investing abroad needs the host's consent (AI accepts or refuses based on relations and profile). It earns returns and influence, and the host gains GDP. AI countries invest in the player's cities the same way (the player can accept or refuse). War or sanctions freeze foreign investments.

**Weapons:** buy from other countries (seller must agree; sanctions block it) or produce at home after building the matching factory (drone factory, missile factory, air-defense factory).

**Inflation:** caused by printing money, large budget deficits and overspending relative to GDP. Effects: lower public support and lower real value of money and investments. When inflation passes a threshold, an urgent notification arrives as a message from the Minister of Finance. Printing money is a player action: instant cash, inflation rises.

**Resources and trade:** five resources: oil, gas, food, rare metals, semiconductors (chips). Each country produces some and imports the rest. Shortages hurt GDP and stop dependent production (no chips = drone and missile factories stop).

**Sanctions** cut trade, weapons sales and investment between the countries involved. Their effect depends on how much the target depends on the sanctioning country.

## 7. Population, stability, revolution and assimilation

There are no elections; public support is the player's lifeline, and losing it leads to riots, then revolution or a coup.

**Public support (0–100%), per province and national average.** Raised by: GDP growth, services, low inflation, won wars, investment in that province. Lowered by: inflation, high taxes, war losses, mandatory service (when introduced), sanctions on the country, missile damage, ignored summits.

**Escalation ladder:**

1. Support falls below a threshold in a province → **riots** (lower production, notification).
2. Riots continue and national support keeps falling → **revolution or coup**: a rebel faction spawns and takes cities.
3. Rebels take the whole country → **game over**.
4. Player defeats the rebels → the country survives with economic and financial damage (lost production, debt, lower GDP for a period).
5. Rebels hold part of the country for a set number of turns → that part **secedes as a new country** the player can fight or make peace with.

AI countries follow the same rules.

**Assimilation:** conquered cities keep their culture and are less productive and less loyal until assimilated. Cost grows with city size and cultural distance. "Assimilate all" assimilates every eligible city in one click; before confirming it shows the total cost and the risk (temporary unrest in those cities for several turns).

## 8. Military

Soldiers come only from recruitment; reserves exist only for defense; bases decide how much a city can recruit, train and defend.

**Mandatory military service:** each country starts with its real status (has it or not). The player can introduce or abolish it. With it: a growing reserve pool and cheaper recruitment, but lower public support when introduced. Without it: no new reservists; existing reserves shrink over time.

**Unit types (demo):**

| Unit | Source | Strength | Can attack | Notes |
| --- | --- | --- | --- | --- |
| Regular soldiers | Recruitment in cities | 1× | Yes | Main army; costs upkeep |
| Reservists | Mandatory service | 1× | No, defense only | Last line of defense; activate only when their city is attacked and it has a base |
| Special forces | Training at a large base | 2.5× | Yes | Expensive and slow to train |
| Trainees | In training at a base | Below 1× | No | Join the defense of their city if it is attacked |

**Bases (levels 1–3, to be tuned):** a higher level allows more recruitment in that city, activates more reservists and trainees when the city is defended, and from a set level unlocks special forces training. A small attack on a city with a base can be beaten by its reservists and trainees.

**Recruitment:** select one or many cities, then either a **fixed number per city** (takes what is available, with a warning where short) or a **percentage of available manpower** per city.

**Multi-select orders:** move armies from many cities to one target, attack from many cities at once, recruit or invest in many cities in one action.

**Movement and combat:** one city per turn; borders rule in section 5. Combat uses strength, numbers, defender bonus, base level and supply.

**Naval transport (simplified):** armies cross the sea along routes between port cities. A crossing takes several turns and can be intercepted. A full navy comes after the demo.

**Alliances in war:** when an alliance or pact member is attacked, each member decides whether to join (based on its AI profile's alliance loyalty and the situation); it is not automatic.

**Ending wars — peace treaties:** a war score builds from captured cities, battles won and damage dealt. The peace screen lets the winner demand: territory, reparations, vassalization, demilitarization of border provinces. The size of the demands is capped by the war score.

## 9. Missiles, drones, air defense and nuclear weapons

Missiles and drones destroy but never capture; air defense protects an area; nuclear weapons deter at a catastrophic price.

| Weapon | Movement | Effect | Can capture | Countered by |
| --- | --- | --- | --- | --- |
| Missiles | Hit on the next turn, any distance in range | Destroy buildings, bases and factories; kill soldiers. Stronger missiles hit more cities and kill more | No | Air defense in range |
| Drones | Move like armies, one city per turn | Destroy structures and kill soldiers where they arrive | No | Air defense in range |
| Air defense | Static, placed in a city | Intercepts a share of missiles and drones within its radius | — | Overwhelmed by volume |
| Nuclear weapons | Hit on the next turn | Massive destruction | No | Capturing or destroying the launch base |

**Missile and drone tiers:** several strength tiers per weapon (to be defined in data). A higher tier means more damage and more cities affected per strike, at a higher price.

**Air defense:** covers a radius around its city. Upgrades raise interception rate and radius, at a higher cost. Coverage is visible as a map mode.

**Nuclear weapons:**

- Only countries that have them at the start (real data) or that build them later through a long, expensive program.
- Nuclear bases are visible to everyone on the map in the demo (hidden locations come later with intelligence).
- Capturing or destroying a nuclear base removes that base's launch capability.
- Use triggers catastrophic consequences for the country that uses them: global sanctions, relations collapse with almost every country, a large drop in public support, possible revolution.
- The AI threatens with nuclear weapons according to its profile, but uses them only when it is about to lose the country.

## 10. Diplomacy

Every country starts with its real relations, alliances, pacts and rivalries; every diplomatic action costs diplomatic points and changes relations.

**Relations:** −100 (hostile) to +100 (close ally) between every pair of countries, starting from real data.

| Action | What it does | Notes |
| --- | --- | --- |
| Alliance / pact | Join, propose, leave | Members choose whether to join a war (section 8) |
| Sanctions | Cut trade, weapons sales and investment | Lower relations; may push the target closer to your rivals |
| Ultimatum | A demand with a deadline and a stated threat | See rules below |
| Foreign base | Ask, pay, or demand by ultimatum to build a base in another country | Host can refuse; base extends your reach and defense |
| Aid | Send money or weapons to a country (also one at war) | Raises relations; the enemy of the receiver resents it |
| Weapons trade | Buy or sell weapons | Blocked by sanctions |
| Vassals | Ask a country to become your vassal, offer to become one, transfer a vassal to another country | Vassals pay tribute and follow their overlord in war |
| Investment abroad | Section 6 | Needs host consent |

**Ultimatum rules:**

- Every ultimatum has a deadline (default 3 turns) and an explicit threat: sanctions, war, or leaving an alliance.
- The receiver accepts or refuses. Ultimatums can be sent and received by the player and the AI.
- If the sender does not carry out the threat after a refusal, it loses **credibility**. Low credibility makes future ultimatums weaker and more likely to be refused.

## 11. AI behavior profiles

Each AI country imitates the real country's foreign-policy behavior through a profile of traits; the aggressiveness setting scales the hostile traits up or down. The AI never acts randomly outside its profile.

| Trait (0–100) | Meaning | Hostile trait |
| --- | --- | --- |
| Interventionism | How often it gets involved in other countries' conflicts and crises | Yes |
| Sanctions tendency | How quickly and often it uses sanctions | Yes |
| Pressure on weaker states | How often it threatens or sends ultimatums to smaller countries | Yes |
| Expansionism | Desire for territory or vassals | Yes |
| Risk tolerance | Open war versus indirect means (aid, weapons, sanctions) | Yes |
| Nuclear posture | Willingness to threaten with nuclear weapons | Yes |
| Alliance loyalty | How reliably it joins wars for allies | No |
| Economic focus | Investment in itself and others versus the military | No |

Each profile also lists **rivals** and **partners** by country. Example: United States — high interventionism, high sanctions tendency, high pressure on weaker states; rivals include China, Russia and Iran.

**Rule for building profiles:** every score is based on verifiable behavior (alliance memberships, foreign bases, sanctions history, military spending, participation in wars) with a one-line justification in the data file. No opinion-based scores. This keeps the game credible for players from every country.

**Aggressiveness multipliers** apply to hostile traits only: Peaceful ×0.5, Realistic ×1, Aggressive ×1.5, Chaos = maximum plus extra randomness in timing. Example: on Peaceful, the United States still sanctions Iran but rarely goes to war; on Chaos it intervenes in almost every conflict.

## 12. Summits, events, notifications and reports

A diplomatic summit happens once a year (every 52 turns) plus emergency summits; urgent notifications arrive immediately, and a general report arrives every 10 turns.

**Summits:**

- **Regular:** one per year. Type rotates: UN General Assembly, G20-style economic summit, regional summit of the player's region, alliance summit (if the player is in one).
- **Emergency:** triggered by major events: a war between two large powers, a nuclear threat or use, a large country collapsing into revolution.
- **Attend or skip.** Skipping has consequences: lower relations with the hosts and members, lost credibility, sometimes a resolution passed against the player.
- **If attending:** 2–4 questions generated from the current situation, each with 3–4 answers. Each answer changes relations, support or credibility. Questions are templates filled with live data. Examples:
  - "Your forces entered {country} two months ago. The assembly asks for your explanation."
  - "Inflation in your country reached {x}%. Partners ask whether you will accept an aid package with conditions."
  - "{rival} accuses you of supplying weapons to {side}. How do you respond?"
  - "The summit proposes joint sanctions on {country}. Do you join?"

**Urgent notifications (immediate):** war declared on the player, ultimatum received, missile or drone strike, riots or revolution, inflation passing the threshold, an ally attacked, summit invitation. Delivered as messages from ministers (Finance, Defense, Foreign Affairs, Interior).

**General report (every 10 turns):** GDP change, budget, support, wars started and ended worldwide, new sanctions and alliances, biggest changes in relations.

**News ticker / newspaper:** short in-game headlines about world events, in the game's own visual style.

## 13. UI and UX

The interface must work equally on a phone (touch, small screen) and on a PC (mouse, large screen).

**Phones play in landscape:** on the first tap the game goes full screen and locks to landscape where the browser allows it; otherwise an upright phone sees a "turn your phone" screen. (Added by Dario in Phase 21.)

**End of the game:** a full-screen **Defeat** when the player loses the last province (to an enemy or to the rebels), a full-screen **Victory** when the player owns every inhabited province of the world; both in the chosen language. (Added by Dario in Phase 21.)

**Main screen:** the map fills the screen; a top bar shows money, GDP, inflation, support, manpower, diplomatic points and the date; the "Next Turn" button sits bottom right; panels open over the map and close with one tap.

**Map modes:** political, economy (GDP per province), public support, alliances, relations toward the player (green to red), military, air-defense coverage, resources.

**Controls:**

- Tap/click a city or province: info panel with actions.
- Multi-select: a selection mode for tapping several cities (phone) or drag/Shift-click (PC); one action applies to all selected.
- Pinch/scroll to zoom, drag to pan.

**Advisors:** four ministers (Finance, Defense, Foreign Affairs, Interior) deliver warnings and tips. They double as the tutorial in the first turns.

**Country goals:** each country has 3–5 goals (example: reach a GDP target, avoid riots for 5 years, join or stay out of an alliance). Shown in a goals panel.

**Safety and comfort:**

- Confirmation before dangerous actions (attacking an alliance member, using nuclear weapons, printing money, mass assimilation).
- Autosave every turn plus several manual save slots; save export/import as a file.
- Settings: language, disputed territories display, sound, UI scale.

**Main menu:** New Game (Modern World — Recommended), the locked "Coming soon" historical modes, Load Game, Settings.

**Visual style — "Situation Room" (first direction, open to change):** minimal and clean, but with character: the game should feel like a modern command center reading live intelligence on a cartographer's map.

- **Two themes:** Day (warm off-white "map paper", ink-dark lines) and Night (deep navy "command screen", soft light lines). Night is the default.
- **Map colors:** countries in a calm, slightly desaturated palette so the map stays readable; the player's country always carries one signature accent color (signal amber) with a soft glow on its border.
- **Meaning by color, used sparingly:** red only for war, attacks and danger; green for allies; amber for the player; everything else stays quiet.
- **Typography:** one clean sans-serif (Inter, SIL OFL) bundled with the game for all text, headings and map labels; numbers use its tabular figures so columns line up. (Changed by Dario in Phase 21: the earlier monospace numbers felt too robotic.)
- **Panels as dossiers:** info panels look like layered briefing cards with a thin header strip (country code, date, classification-style label), sliding in over the map.
- **Leaders without images:** each leader gets a typographic seal (initials inside a geometric emblem in the country's color).
- **Motion with purpose:** missiles as thin animated arcs with a timer badge until impact; impacts as a short ripple; drones and armies as small chevrons moving along routes; air-defense radius as a faint pulsing ring; urgent notifications slide in like incoming telegrams.
- **News ticker:** a thin wire-service strip at the bottom of the screen.

**Sound:** minimal for the demo: UI clicks, a short alert for urgent notifications, missile launch and impact sounds, one calm ambient music track. CC0 or self-made audio only. Separate volume sliders for music and effects; muted by default on phones until the player turns it on.

**Demo feedback:** a "Send feedback" button in the menu linking to a simple external form (what was fun, what was confusing, device used). No analytics or tracking in the demo, so no consent banner is needed.

## 14. Data, sources and verification

All world data lives in JSON files under `data/modern/`; Claude Code drafts it, and Dario verifies it before release.

| Data | Source | Who verifies |
| --- | --- | --- |
| Borders, provinces | Natural Earth admin-0 and admin-1 (public domain) | Automatic checks + visual review |
| Cities | Natural Earth populated places (public domain) | Automatic checks |
| GDP, population, budget, debt | World Bank and IMF open data | Spot checks |
| Military size, reserves, mandatory service | Public estimates, rounded | Dario |
| Leaders (name + title) | Official government sites | Dario, at every data update |
| Alliances, pacts, wars | Official alliance and government sources | Dario |
| Relations and AI profiles | Drafted from documented behavior, each with a one-line justification | Dario |
| Resources | Open production and trade statistics | Spot checks |

**Rules:**

- Every data file records its source and the date it was checked.
- The start date is a single value in `data/modern/scenario.json`. Before release, it is set to the date the data was last verified.
- No copyrighted assets: no images of leaders, no content from other games; flags drawn from public-domain sources or simplified in the game's own style.
- Every data change goes through a validation script (all provinces have an owner, all references point to existing ids, numbers within sane ranges).

## 15. Out of scope for the demo (roadmap)

These come after the demo, in rough order of value; the architecture must not block any of them.

1. Historical modes, starting with the Cold War (same weapons and diplomacy systems, new data).
2. Intelligence and espionage (hidden nuclear bases, revealing enemy plans).
3. UN Security Council with resolution votes.
4. Full navy (fleets, naval battles, blockades).
5. Refugees and migration.
6. Mod support (community scenarios through data files).
7. Steam build (Electron or Tauri) and mobile builds (Capacitor).
8. Ads and in-app purchases (cosmetics, extra modes, ad removal; never military or economic advantage).
9. Multiplayer.

## 16. Development phases

Fourteen phases, each one or more Claude Code sessions; a phase is done only when its check passes on the live GitHub Pages link, on both PC and phone.

0. **Project setup** — repo structure, Vite + TypeScript + PixiJS, tests, GitHub Pages deploy, `docs/GDD.md`, `PROGRESS.md`, `CLAUDE.md`. Done when: an empty page with "Modern Leader" loads from the Pages link on the phone.
1. **Map data pipeline** — Natural Earth → provinces, province bitmap, adjacency, cities, sea routes. Done when: validation script passes, all provinces present.
2. **Map rendering** — map on screen, zoom, pan, tap a province for its name and owner, political map mode. Done when: smooth on the phone.
3. **Countries and setup screens** — country data, main menu, aggressiveness, country list with difficulty stars, leader name, disputed-territory setting, translation system. Done when: a game can be started for any full-status country.
4. **Turn engine and saves** — turn loop (section 5), "Next Turn", date, autosave, save slots, export/import.
5. **Economy** — budget, taxes, investment (own and foreign), buildings, inflation, printing money.
6. **Population** — support, riots, revolution, rebels, secession, assimilation.
7. **Military** — service, reserves, bases, special forces, recruitment, movement, borders rule, combat, multi-select orders, naval routes.
8. **Missiles, drones, air defense, nuclear.**
9. **Diplomacy** — relations, alliances, sanctions, ultimatums, credibility, vassals, foreign bases, aid, weapons trade, peace treaties.
10. **Resources and trade.**
11. **AI** — profiles, aggressiveness scaling, AI decisions in every system.
12. **Summits, events, notifications, reports, news, advisors, goals.**
13. **Balance, polish, demo release** — long automated AI-only simulations, performance on phone, publish the demo (GitHub Pages + itch.io).

## 17. Claude Code prompts

The first three prompts are below; the next ones are written after each phase is checked, because they build on what Claude Code actually produced.

**Before Prompt 0 (once):**

1. On GitHub, create a public repository (tick "Add a README file") named `modern-leader` (public is required for free GitHub Pages).
2. Upload `GDD.md` (this document exported as Markdown) to the repo root: GitHub website → Add file → Upload files. Prompt 0 moves it into `docs/`.
3. Open Claude Code (PC or website/app), select the `modern-leader` repo, and paste Prompt 0.

**For every prompt:** one prompt per session; wait until Claude Code says it pushed; open the Pages link on the phone and the PC; check the "Done when" item; only then move on.

### Prompt 0 — Project setup

```text
You are building "Modern Leader" (code name ML), a turn-based geopolitical grand-strategy web game. The full game design is in docs/GDD.md (if GDD.md is in the repository root instead, first move it to docs/GDD.md). Read it completely before doing anything. It is the source of truth; never change a design decision in it without asking me.

Task: set up the project foundation only. No gameplay yet.

1. Tooling: Vite + TypeScript (strict mode) + PixiJS (latest stable major) + Vitest. Add ESLint and Prettier with sensible defaults. Use npm.
2. Folder structure:
   - src/sim/      simulation core: pure TypeScript, must NEVER import PixiJS or touch the DOM
   - src/map/      PixiJS map rendering
   - src/ui/       HTML/CSS panels over the canvas
   - src/i18n/     translation system
   - data/modern/  game data (JSON) for the Modern World mode
   - tools/        data preprocessing scripts
   - docs/         GDD.md (already there)
3. Translation system: src/i18n with en.json and sr.json and a t(key, params) function. Every visible string goes through t(). English is the default; add a language switch in a temporary settings stub.
4. Placeholder app: full-screen PixiJS canvas (correct on phones: viewport meta, no page scroll, handles resize and device pixel ratio), centered text "Modern Leader", and a small corner label with version and build date.
5. Deployment: a GitHub Actions workflow that runs tests, builds, and deploys to GitHub Pages on every push to main. Configure Vite base path for the repo name "modern-leader".
6. Tests: one trivial Vitest test in src/sim so the pipeline is proven.
7. Create CLAUDE.md with permanent rules for every future session:
   - Read docs/GDD.md and PROGRESS.md at the start of every session.
   - Keep the three layers separate (sim / data / presentation). The presentation layer changes state only through command objects.
   - The simulation must be deterministic (seeded random only).
   - All game data in JSON under data/, never hard-coded.
   - All UI text through t().
   - Code, comments and commit messages in English.
   - Write tests for every simulation rule; run tests and the build before every commit.
   - Every phone-facing feature must work with touch and on small screens.
   - Finish every session by updating PROGRESS.md (what was done, what is next, known issues), committing and pushing.
8. Create PROGRESS.md with Phase 0 status and the phase list from GDD section 16.
9. Commit and push.

When finished, tell me in simple steps how to turn on GitHub Pages (Settings → Pages → Source: GitHub Actions) and the exact URL where the game will be. Done when: the placeholder loads from that URL on my phone.
```

### Prompt 1 — Map data pipeline

```text
Read CLAUDE.md, docs/GDD.md (especially sections 4 and 14) and PROGRESS.md. This session is Phase 1: the map data pipeline. No rendering yet.

Goal: turn Natural Earth public-domain data into game-ready data files. Keep ALL admin-1 regions. Do not merge or simplify provinces away.

1. Get Natural Earth 10m data (admin-0 countries, admin-1 states/provinces, populated places), preferably from the nvkelso/natural-earth-vector GitHub repository. If a download is blocked, stop and tell me exactly which files to upload myself.
2. Write the pipeline as scripts in tools/ (TypeScript run with Node, or Python if clearly better; document how to run it). The output is committed so the game never needs the raw data.
3. Outputs in data/modern/:
   - provinces.json: id, name, owner country id, centroid, area, neighbor province ids, isCoastal.
   - countries.json (skeleton for now): id (ISO3 where possible), name key, status (full | disputed) per GDD section 4, capital province id, list of province ids. Leave economic and political fields for Phase 3.
   - cities.json: id, name, province id, population, isCapital, isPort. Every province has at least one city; if Natural Earth has none, create one at the province centroid named after the province.
   - Province ID map: a raster where each province has a unique color, plus a lookup from color to province id. It must render correctly on phones: respect a 4096 px maximum texture size (tile the map if needed). Choose a projection that looks good for a world strategy map and document the choice.
   - Border data for crisp country and province borders.
   - A draft sea-route graph connecting port cities across sea areas (simple is fine; Phase 7 will refine it).
4. Disputed territories (GDD section 4): Kosovo, Western Sahara, Northern Cyprus, Abkhazia, South Ossetia, Transnistria, Somaliland must exist as their own territories with status "disputed". Vatican City, Palestine and Taiwan have full status. If Natural Earth does not separate one of them, build it from the correct admin-1 regions or report it to me. Do not guess silently.
5. Validation script (tools/validate): every province has exactly one owner; every reference points to an existing id; neighbors are symmetric; every country has a capital; no empty provinces; file sizes reported. Add it to the test run.
6. Report: total provinces, cities, countries; data size (raw and gzipped); anything you had to decide or could not resolve.
7. Update PROGRESS.md, commit, push.

Done when: the validation passes and the report lists no unresolved problems.
```

### Prompt 2 — Map rendering

```text
Read CLAUDE.md, docs/GDD.md (sections 4 and 13) and PROGRESS.md. This session is Phase 2: map rendering. Use the data produced in Phase 1.

1. Render the world map with PixiJS from the province ID map. Color provinces by owner country using a GPU lookup (shader or palette texture), so recoloring thousands of provinces is instant. This is the base for all future map modes.
2. Draw country borders clearly and province borders more subtly; province borders fade out when zoomed out.
3. Controls: mouse wheel and pinch to zoom, drag to pan (mouse and touch), limits so the map cannot be lost off-screen; smooth inertia on touch.
4. Tap or click a province: highlight it and open an HTML info panel showing province name, owner country, and its cities. Closes with one tap.
5. Labels: country names when zoomed out, province and city names only when zoomed in. Use t() for all UI text.
6. Map mode system: implement the framework plus the Political mode. Other modes come in later phases.
7. Performance: target 60 fps on PC and at least 30 fps on a mid-range phone. Add a hidden FPS counter toggled in the settings stub. Load data asynchronously with a simple loading screen.
8. Update PROGRESS.md, commit, push.

Done when: on my phone the full map loads, zooming and panning are smooth, and tapping any province shows the right name and owner.
```

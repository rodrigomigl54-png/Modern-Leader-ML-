# Store checklists

Master plan, section 9. Working checklists for Google Play, the Apple App Store and Steam,
**not legal advice and no guarantee of approval**. Each line says whether it can be checked
automatically in this repository ("auto") or needs a person ("human"), and its current state.
See `LICENSES.md` for the rights inventory.

State: ✅ done · ⚠️ needs work · ❓ needs a decision or review · — not started

## Common to all stores

| Item                                                                                             | Check                                    | State                                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------- |
| Runs without crashes on target devices; no console errors in the tested flows                    | auto (Playwright) + human (real devices) | ⚠️ emulated phone and PC only                                                |
| Save games survive updates (versioned saves, `ensure*` migrations)                               | auto (tests)                             | ✅                                                                           |
| Works offline after loading                                                                      | human                                    | ❓ the web build loads data over the network; a store build should bundle it |
| Credits with data attributions (World Bank CC BY 4.0, IMF, SIPRI, Natural Earth, PixiJS, Inter)  | human                                    | ⚠️ missing                                                                   |
| Real people (leaders' names)                                                                     | human                                    | ❓ decide: keep, or offer generic names                                      |
| Sensitive content: war, nuclear strikes, real conflicts and disputed territories                 | human                                    | ❓ age rating answers; disputed-territory modes exist                        |
| Privacy: the game collects no personal data, no analytics, no accounts; saves stay on the device | auto (code review)                       | ✅ (the feedback link opens GitHub in the browser)                           |
| Monetization                                                                                     | —                                        | — none yet (master plan, section 10: only after the core game is stable)     |

## Google Play

| Item                                                                                             | Check | State                        |
| ------------------------------------------------------------------------------------------------ | ----- | ---------------------------- |
| Package as an Android app (e.g. Trusted Web Activity or Capacitor) with current target API level | human | —                            |
| Data safety form: "no data collected"                                                            | human | ❓ true for the current game |
| Permissions: none needed                                                                         | auto  | ✅                           |
| Content rating questionnaire (IARC): violence (war, missiles, nuclear), real conflicts           | human | —                            |
| Intellectual property: flags, real names, organization names                                     | human | ❓ see `LICENSES.md`         |
| Ads / in-app purchases: Play Billing only, families policy if under 13                           | human | — none                       |
| Store listing: screenshots, icon (512 px), feature graphic, short and full description           | human | —                            |

## Apple App Store

| Item                                                                                                       | Check | State                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------- |
| Native wrapper with real app value (Guideline 4.2: not just a website)                                     | human | ❓ the game is fully playable offline only once data is bundled |
| App Privacy "nutrition label": no data collected                                                           | human | ❓ true for the current game                                    |
| Guideline 1.1 (objectionable content): realistic war, nuclear weapons, real leaders and conflicts          | human | ❓ main review risk; consider fictional leader names            |
| Guideline 5.2 (intellectual property): flags, names, trademarks                                            | human | ❓ see `LICENSES.md`                                            |
| Completeness and stability (2.1): no placeholders ("Coming soon" historical modes are visible in the menu) | human | ⚠️ hide unfinished modes in a store build                       |
| In-app purchases through StoreKit only                                                                     | human | — none                                                          |
| Age rating questionnaire                                                                                   | human | —                                                               |

## Steam

| Item                                                                                                                                                 | Check        | State                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------- |
| Steamworks onboarding (developer account, tax and bank forms, fee)                                                                                   | human        | —                                                       |
| Desktop build (e.g. Electron or Tauri wrapper) with mouse and keyboard controls                                                                      | human        | — (controls already support mouse, wheel, Shift-select) |
| Content Survey: violence, real conflicts; **AI-generated content disclosure** (code, texts and icons made with AI assistance; no AI image generator) | human        | ❓ answer per `LICENSES.md`                             |
| Store page assets: capsule images, screenshots, trailer, description                                                                                 | human        | —                                                       |
| Build quality: settings (graphics quality, fewer animations, language), saves, no debug tools in builds                                              | auto + human | ✅ debug hooks are development-only                     |
| Pricing: premium purchase (master plan, section 10)                                                                                                  | human        | ❓                                                      |

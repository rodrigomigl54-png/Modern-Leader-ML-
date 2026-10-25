// Long AI-only simulations for balancing (GDD section 16, Phase 13): plays the Modern World for
// several years on every aggressiveness level with a passive player and prints yearly world
// statistics. Usage: npm run sim:balance -- [--years 10] [--levels realistic,chaos] [--seed 1]
//   [--player ISL] [--out balance.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { DATA_DIR, ROOT } from '../map/paths.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const years = Number(option('years', '10'));
const levels = option('levels', 'peaceful,realistic,aggressive,chaos').split(',');
const seed = Number(option('seed', '1'));
const player = option('player', 'ISL');
const outFile = option('out', '');
const watch = option('watch', '').split(',').filter(Boolean);
/** Weekly trace of the watched countries between two turns, e.g. --trace 229-260. */
const trace = option('trace', '').split('-').map(Number);

/** Events worth listing by name in the yearly log. */
const NOTABLE: Record<string, (e: Record<string, string>) => string> = {
  warDeclared: (e) => `war ${e.attacker}>${e.target}`,
  peace: (e) => `peace ${e.a}-${e.b}`,
  countryConquered: (e) => `${e.by} conquered ${e.countryId}`,
  revolutionSucceeded: (e) => `government of ${e.countryId} fell`,
  secession: (e) => `${e.newCountryId} seceded from ${e.countryId}`,
  nuclearStrike: (e) => `NUCLEAR ${e.attacker}>${e.defender}`,
  globalSanctions: (e) => `world sanctions ${e.countryId}`,
};

const read = (file: string): unknown => JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
const readOptional = (file: string): unknown => {
  try {
    return read(file);
  } catch {
    return null;
  }
};

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const { assembleWorld } = await server.ssrLoadModule('/src/app/worldData.ts');
  const { createNewGame } = await server.ssrLoadModule('/src/sim/newGame.ts');
  const { advanceTurn } = await server.ssrLoadModule('/src/sim/turn.ts');
  const { nationalSupport } = await server.ssrLoadModule('/src/sim/population.ts');
  const { militaryTotals } = await server.ssrLoadModule('/src/sim/military.ts');
  const { targetSupport } = await server.ssrLoadModule('/src/sim/population.ts');
  const { weeklyBudget, growthRate } = await server.ssrLoadModule('/src/sim/economy.ts');

  const map = {
    provinces: (read('provinces.json') as { provinces: unknown[] }).provinces,
    countries: (read('countries.json') as { countries: unknown[] }).countries,
    cities: (read('cities.json') as { cities: unknown[] }).cities,
  };
  const bundle = assembleWorld(map, {
    leaders: read('leaders.json'),
    diplomacy: read('diplomacy.json'),
    scenario: read('scenario.json'),
    economy: read('economy.json'),
    population: read('population.json'),
    military: read('military.json'),
    service: read('military-service.json'),
    sea: read('sea-routes.json'),
    weapons: read('weapons.json'),
    diplomacyRules: read('diplomacy-rules.json'),
    relations: read('relations.json'),
    resources: read('resources.json'),
    profiles: read('ai-profiles.json'),
    aiRules: read('ai-rules.json'),
    summits: read('summits.json'),
    goals: read('goals.json'),
    startDebt: read('debt.json'),
    stats: readOptional('country-stats.json'),
  });
  const sim = bundle.sim;
  const results: Record<string, unknown[]> = {};

  for (const level of levels) {
    let state = createNewGame(
      bundle.world,
      {
        aggressiveness: level,
        disputedMode: 'neutral',
        countryId: player,
        leaderName: 'Sim',
        seed,
      },
      sim,
    );
    const live = (): { id: string }[] =>
      state.world.countries.filter(
        (c: { provinceIds: number[]; status: string }) =>
          c.provinceIds.length > 0 && c.status !== 'uninhabited',
      );
    const startCountries = live().length;
    const startGdp: Record<string, number> = {};
    for (const [id, e] of Object.entries(state.economy.countries))
      startGdp[id] = (e as { gdp: number }).gdp;
    const rows: unknown[] = [];
    console.log(`\n=== ${level} (seed ${seed}, player ${player}) ===`);
    let counts: Record<string, number> = {};
    let notes: string[] = [];
    let ms = 0;
    const printWatched = (): void => {
      for (const id of watch) {
        const e = state.economy.countries[id];
        const c = state.world.countries.find((x: { id: string }) => x.id === id);
        if (!e || !c) continue;
        const b = weeklyBudget(state, id, sim);
        const targets = c.provinceIds.map((p: number) => targetSupport(state, sim, p));
        const pct = (x: number): string => (x * 100).toFixed(1);
        console.log(
          `  ${id}: prov ${c.provinceIds.length} gdp ${(e.gdp / 1e9).toFixed(0)}bn growth ${pct(growthRate(e, sim.economy))}% tax ${pct(e.taxRate)} serv ${pct(e.servicesShare)} infl ${pct(e.inflation)} debt/gdp ${pct(e.debt / e.gdp)} treas ${(e.treasury / 1e9).toFixed(1)}bn bal/wk ${(b.balance / 1e6).toFixed(0)}m support ${nationalSupport(state, sim, id).toFixed(0)} target ${Math.min(...targets).toFixed(0)}-${Math.max(...targets).toFixed(0)} riots ${c.provinceIds.filter((p: number) => state.population.riotTurns[p] > 0).length} foreign ${c.provinceIds.filter((p: number) => state.population.culture[p] !== id).length} soldiers ${Math.round(militaryTotals(state, id).regulars / 1000)}k sanctions ${state.diplomacy.sanctions.filter((x: { to: string }) => x.to === id).length}`,
        );
      }
    };
    for (let turn = 1; turn <= years * 52; turn++) {
      const t0 = performance.now();
      const r = advanceTurn(state, sim);
      ms += performance.now() - t0;
      state = r.state;
      for (const e of r.events as Record<string, string>[]) {
        counts[e.type!] = (counts[e.type!] ?? 0) + 1;
        const note = NOTABLE[e.type!];
        if (note) notes.push(`w${turn} ${note(e)}`);
      }
      if (trace.length === 2 && turn >= trace[0]! && turn <= trace[1]!) {
        const battles = (r.events as Record<string, unknown>[]).filter((e) => e.type === 'battle');
        for (const id of watch) {
          const c = state.world.countries.find((x: { id: string }) => x.id === id);
          const mine = state.military.armies.filter((a: { owner: string }) => a.owner === id);
          const front = mine.filter((a: { provinceId: number }) =>
            (sim.provinceNeighbors[a.provinceId] ?? []).some(
              (q: number) =>
                watch.includes(state.world.provinceOwners[q]) &&
                state.world.provinceOwners[q] !== id,
            ),
          );
          const sum = (xs: { regulars: number }[]): number =>
            Math.round(xs.reduce((t, a) => t + a.regulars, 0) / 1000);
          const won = battles.filter(
            (b) =>
              (b.attacker === id && b.winner === 'attacker') ||
              (b.defender === id && b.winner === 'defender'),
          ).length;
          const lost = battles.filter((b) => b.attacker === id || b.defender === id).length - won;
          console.log(
            `  t${turn} ${id} prov ${c?.provinceIds.length} armies ${mine.length} (${sum(mine)}k) front ${front.length} (${sum(front)}k) moving ${mine.filter((a: { path: number[] }) => a.path.length).length} battles won ${won} lost ${lost} treas ${(state.economy.countries[id].treasury / 1e9).toFixed(1)}bn`,
          );
        }
      }
      if (trace.length === 2 && turn >= trace[0]! && turn <= trace[1]! && turn % 4 === 0)
        printWatched();
      if (turn % 52 !== 0) continue;

      const ids = live()
        .map((c) => c.id)
        .filter((id) => state.economy.countries[id]);
      const econ = ids.map((id) => state.economy.countries[id]);
      const median = (xs: number[]): number => {
        const s = [...xs].sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)] ?? 0;
      };
      const growth = ids
        .filter((id) => startGdp[id])
        .map((id) => (state.economy.countries[id].gdp / startGdp[id]!) ** (52 / turn) - 1);
      const supports = ids.map((id) => nationalSupport(state, sim, id));
      const soldiers = ids.reduce((sum, id) => {
        const t = militaryTotals(state, id);
        return sum + t.regulars + t.special;
      }, 0);
      const unstable = ids.filter((id, i) => supports[i]! < 30);
      const row = {
        year: turn / 52,
        countries: ids.length,
        lost: startCountries - ids.length,
        wars: state.world.wars.length,
        warsStarted: counts.warDeclared ?? 0,
        peace: counts.peace ?? 0,
        conquered: counts.countryConquered ?? 0,
        revolutions: counts.revolution ?? 0,
        governmentsFallen: counts.revolutionSucceeded ?? 0,
        secessions: counts.secession ?? 0,
        nuclear: counts.nuclearStrike ?? 0,
        sanctions: state.diplomacy.sanctions.length,
        alliances: state.world.alliances.length,
        medianGrowth: +(median(growth) * 100).toFixed(2),
        worstGrowth: +(Math.min(...growth) * 100).toFixed(1),
        inflationOver20: econ.filter((e: { inflation: number }) => e.inflation > 0.2).length,
        debtOver100: econ.filter((e: { debt: number; gdp: number }) => e.debt > e.gdp).length,
        broke: econ.filter((e: { treasury: number }) => e.treasury < 0).length,
        medianSupport: +median(supports).toFixed(1),
        supportUnder30: unstable.length,
        unstable: unstable.join(' '),
        armies: state.military.armies.length,
        soldiersM: +(soldiers / 1e6).toFixed(2),
        msPerTurn: +(ms / 52).toFixed(1),
        saveKB: Math.round(JSON.stringify(state).length / 1024),
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (notes.length) console.log('  ' + notes.join('; '));
      printWatched();
      (row as Record<string, unknown>).notes = notes;
      notes = [];
      counts = {};
      ms = 0;
    }
    results[level] = rows;
  }
  if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));
} finally {
  await server.close();
}

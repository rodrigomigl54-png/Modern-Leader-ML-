import { describe, expect, it } from 'vitest';
import aiRulesData from '../../data/modern/ai-rules.json';
import profilesFile from '../../data/modern/ai-profiles.json';
import countriesFile from '../../data/modern/countries.json';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import weaponsRulesData from '../../data/modern/weapons.json';
import { applyCommand, type Command } from './commands';
import { relation, sanctioned, type DiplomacyRules } from './diplomacy';
import type { EconomyRules, SimContext } from './economy';
import type { MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import { TRAITS, trait, type AiProfile, type AiRules, type Trait } from './profiles';
import { advanceTurn, type TurnEvent } from './turn';
import type { WeaponsRules } from './weapons';
import { enemiesAtWar, type Aggressiveness, type World, type WorldCountry } from './world';

const aiRules = aiRulesData as unknown as AiRules;

const profile = (
  values: Partial<Record<Trait, number>>,
  extra: Partial<AiProfile> = {},
): AiProfile => {
  const p = { partners: [], rivals: [], ...extra } as unknown as AiProfile;
  for (const t of TRAITS) p[t] = [values[t] ?? 20, 'test'];
  return p;
};

const country = (id: string, provinceIds: number[], personnel: number): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 2e6,
    militaryPersonnel: personnel,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

// BIG is strong and hostile toward its weak neighbor SML; PLR is the player far away.
const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('BIG', [0, 1], 200000),
    country('SML', [2], 2000),
    country('PLR', [3], 10000),
  ],
  provinceOwners: ['BIG', 'BIG', 'SML', 'PLR'],
  alliances: [],
  rivalries: [{ a: 'BIG', b: 'SML' }],
  wars: [],
  disputed: [],
});

const sim = (profiles: Record<string, AiProfile>): SimContext => ({
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  weapons: weaponsRulesData as unknown as WeaponsRules,
  diplomacy: diplomacyRulesData as unknown as DiplomacyRules,
  aiRules,
  profiles,
  cityProvince: [0, 1, 2, 3],
  cityPopulation: [1e6, 1e6, 1e6, 1e6],
  cityLonLat: [0, 1, 2, 30].map((i) => [i * 1.8, 0] as [number, number]),
  provincePopulation: [1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1], []],
});

const newGame = (ctx: SimContext, aggressiveness: Aggressiveness = 'realistic'): GameState => {
  const game = createNewGame(
    world(),
    { aggressiveness, disputedMode: 'neutral', countryId: 'PLR', leaderName: 'P', seed: 8 },
    ctx,
  );
  game.diplomacy.relations['BIG|SML'] = -80;
  return game;
};

function play(
  state: GameState,
  ctx: SimContext,
  turns: number,
  events: TurnEvent[] = [],
): GameState {
  for (let i = 0; i < turns; i++) {
    const r = advanceTurn(state, ctx);
    state = r.state;
    events.push(...r.events);
  }
  return state;
}

describe('profile data', () => {
  it('has a complete, justified profile for every inhabited country', () => {
    const profiles = profilesFile.profiles as unknown as Record<string, AiProfile>;
    const ids = countriesFile.countries.filter((c) => c.status !== 'uninhabited').map((c) => c.id);
    for (const id of ids) {
      const p = profiles[id];
      expect(p, id).toBeDefined();
      for (const t of TRAITS) {
        const [value, why] = p![t];
        expect(value, `${id} ${t}`).toBeGreaterThanOrEqual(0);
        expect(value, `${id} ${t}`).toBeLessThanOrEqual(100);
        expect(why.length, `${id} ${t}`).toBeGreaterThan(5);
      }
    }
    expect(profiles.USA!.sanctions[0]).toBeGreaterThan(profiles.SRB!.sanctions[0]);
  });
});

describe('aggressiveness', () => {
  it('scales hostile traits only; Chaos sets them to the maximum', () => {
    const ctx = sim({ BIG: profile({ risk: 60, loyalty: 60 }) });
    const at = (level: Aggressiveness, t: Trait): number =>
      trait(newGame(ctx, level), ctx, 'BIG', t);
    expect(at('peaceful', 'risk')).toBe(30);
    expect(at('realistic', 'risk')).toBe(60);
    expect(at('aggressive', 'risk')).toBe(90);
    expect(at('chaos', 'risk')).toBe(100);
    expect(at('peaceful', 'loyalty')).toBe(60);
    expect(at('chaos', 'loyalty')).toBe(60);
  });
});

describe('AI actions follow the profile', () => {
  it('a country prone to sanctions sanctions its hostile rival; a reluctant one does not', () => {
    const eager = sim({ BIG: profile({ sanctions: 100 }) });
    const reluctant = sim({ BIG: profile({ sanctions: 0 }) });
    expect(sanctioned(play(newGame(eager), eager, 60), 'BIG', 'SML')).toBe(true);
    expect(sanctioned(play(newGame(reluctant), reluctant, 60), 'BIG', 'SML')).toBe(false);
  });

  it('pressures a much weaker hostile neighbor with ultimatums', () => {
    const ctx = sim({ BIG: profile({ pressure: 100, risk: 20, sanctions: 0 }) });
    // About one ultimatum a year at the maximum trait: play long enough to see one.
    const events: TurnEvent[] = [];
    play(newGame(ctx), ctx, 400, events);
    expect(
      events.some((e) => e.type === 'ultimatumAnswered' && e.from === 'BIG' && e.to === 'SML'),
    ).toBe(true);
  });

  it('an expansionist risk-taker attacks a weak hostile neighbor; a peaceful one does not', () => {
    const hawk = sim({ BIG: profile({ expansionism: 100, risk: 100, pressure: 0, sanctions: 0 }) });
    const dove = sim({ BIG: profile({ expansionism: 0, risk: 0, pressure: 0, sanctions: 0 }) });
    const events: TurnEvent[] = [];
    play(newGame(hawk, 'chaos'), hawk, 120, events);
    expect(events.some((e) => e.type === 'warDeclared' && e.attacker === 'BIG')).toBe(true);
    expect(enemiesAtWar(play(newGame(dove, 'peaceful'), dove, 120).world, 'BIG')).toEqual([]);
  });

  it('loyal allies join a war, disloyal ones stay out', () => {
    const join = (loyalty: number): boolean => {
      const ctx = sim({ BIG: profile({}), SML: profile({ loyalty }) });
      const game = newGame(ctx);
      game.world.alliances.push({ id: 'pact', type: 'pact', members: ['SML', 'PLR'] });
      // PLR (player) is attacked by BIG: SML decides.
      game.diplomacy.relations['PLR|SML'] = 30;
      const result = applyCommand(
        game,
        { type: 'declareWar', countryId: 'BIG', targetId: 'PLR' } as Command,
        ctx,
      );
      if (!result.ok) throw new Error(result.error);
      return enemiesAtWar(result.state.world, 'BIG').includes('SML');
    };
    expect(join(100)).toBe(true);
    expect(join(0)).toBe(false);
  });

  it('closes deficits when debt is high', () => {
    const ctx = sim({ BIG: profile({}) });
    const game = newGame(ctx);
    const e = game.economy.countries.BIG!;
    e.debt = e.gdp * 2;
    e.servicesShare = 0.4;
    const tax = e.taxRate;
    const later = play(game, ctx, 12);
    const after = later.economy.countries.BIG!;
    expect(after.taxRate > tax || after.servicesShare < 0.4).toBe(true);
  });

  it('a friendly economic power offers to invest in the player', () => {
    const ctx = sim({ BIG: profile({ economy: 100 }) });
    const game = newGame(ctx);
    game.diplomacy.relations['BIG|PLR'] = 60;
    game.economy.countries.BIG!.treasury = 1e11;
    const events: TurnEvent[] = [];
    const later = play(game, ctx, 200, events);
    const request = later.diplomacy.requests.find((r) => r.type === 'investment');
    expect(events.some((e) => e.type === 'request')).toBe(true);
    if (request) {
      const accepted = applyCommand(
        later,
        { type: 'answerRequest', countryId: 'PLR', requestId: request.id, accept: true },
        ctx,
      );
      if (!accepted.ok) throw new Error(accepted.error);
      expect(
        accepted.state.economy.buildings.some((b) => b.owner === 'BIG' && b.host === 'PLR'),
      ).toBe(true);
    }
  });

  it('an angry people and money in the bank bring better services', () => {
    const ctx = sim({ BIG: profile({}) });
    const game = newGame(ctx);
    const e = game.economy.countries.BIG!;
    e.servicesShare = 0.05;
    e.treasury = 1e12;
    for (const p of [0, 1]) game.population.support[p] = 20;
    const later = play(game, ctx, 12);
    expect(later.economy.countries.BIG!.servicesShare).toBeGreaterThan(0.05);
  });

  it('demobilizes at peace when the army is more than the budget can pay', () => {
    const ctx = sim({ BIG: profile({ expansionism: 0, risk: 0 }) });
    const game = newGame(ctx, 'peaceful');
    for (const a of game.military.armies) if (a.owner === 'BIG') a.regulars *= 20;
    game.economy.countries.BIG!.treasury = 0;
    const soldiers = (s: GameState): number =>
      s.military.armies.filter((a) => a.owner === 'BIG').reduce((t, a) => t + a.regulars, 0);
    const reserves = (s: GameState): number =>
      s.military.reservists[0]! + s.military.reservists[1]!;
    const later = play(game, ctx, 10);
    expect(soldiers(later)).toBeLessThan(soldiers(game));
    expect(reserves(later)).toBeGreaterThan(reserves(game));
  });

  it('at war the capital keeps only part of the army; the rest goes to the front', () => {
    const ctx = sim({ BIG: profile({}) });
    const game = newGame(ctx);
    // The whole army stands in the capital (province 0); the front is province 1.
    const army = game.military.armies.filter((a) => a.owner === 'BIG');
    for (const a of army) {
      a.provinceId = 0;
      a.path = [];
    }
    const declared = applyCommand(
      game,
      { type: 'declareWar', countryId: 'SML', targetId: 'BIG' } as Command,
      ctx,
    );
    if (!declared.ok) throw new Error(declared.error);
    const later = play(declared.state, ctx, 3);
    const outside = later.military.armies.filter((a) => a.owner === 'BIG' && a.provinceId !== 0);
    expect(outside.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const ctx = sim({ BIG: profile({ expansionism: 80, risk: 80, pressure: 80, sanctions: 80 }) });
    const start = newGame(ctx, 'chaos');
    expect(play(start, ctx, 30)).toEqual(play(start, ctx, 30));
    expect(relation(start, ctx, 'BIG', 'SML')).toBe(-80);
  });
});

// Simple AI orders until the real AI with country profiles (Phase 11): countries at war recruit
// toward the army they can pay for, move armies to the front and attack weak neighboring enemy
// provinces. Countries at peace keep their armies where they are. Turn step 1 (GDD section 5).
import { weeklyBudget, type SimContext } from './economy';
import {
  armyStrength,
  citiesOfProvince,
  findPath,
  militaryRules,
  militaryTotals,
  provinceBaseLevel,
  provinceSeat,
  recruitQuote,
  startRecruitment,
  type Army,
} from './military';
import { relation } from './diplomacy';
import type { GameState } from './newGame';
import { trait } from './profiles';
import {
  airDefenseQuote,
  launchDrones,
  launchMissiles,
  launchNuclear,
  launchSiteFor,
  productionQuote,
  startAirDefense,
  startProduction,
  weaponsRules,
} from './weapons';
import { alliesOf, enemiesAtWar } from './world';

const RECRUIT_CITIES = 8;

export function aiMilitaryOrders(state: GameState, ctx: SimContext): void {
  const rules = militaryRules(ctx);
  const owners = state.world.provinceOwners;
  const land = ctx.provinceNeighbors ?? [];
  const armiesIn = new Map<number, Army[]>();
  for (const a of state.military.armies) {
    const list = armiesIn.get(a.provinceId) ?? [];
    list.push(a);
    armiesIn.set(a.provinceId, list);
  }

  /** What an attacker would have to beat in a province (armies, reservists, base). */
  const defenseOf = (provinceId: number): number => {
    const owner = owners[provinceId]!;
    const friends = new Set([owner, ...alliesOf(state.world, owner)]);
    const level = provinceBaseLevel(state, ctx, provinceId);
    const activation = rules.bases.reservistActivation;
    const armies = (armiesIn.get(provinceId) ?? [])
      .filter((a) => friends.has(a.owner))
      .reduce((s, a) => s + armyStrength(rules, a), 0);
    const reservists =
      state.military.reservists[provinceId]! *
      (activation[Math.min(level, activation.length - 1)] ?? 0);
    return (
      (armies + reservists) *
      (1 + rules.combat.defenderBonus + level * rules.bases.defenseBonusPerLevel)
    );
  };

  for (const country of state.world.countries) {
    if (country.id === state.player.countryId || country.provinceIds.length === 0) continue;
    const enemies = new Set(enemiesAtWar(state.world, country.id));
    if (enemies.size === 0) {
      if (country.status !== 'rebels') demobilize(state, ctx, country.id);
      continue;
    }

    if (country.status !== 'rebels') recruit(state, ctx, country.id);

    const own = new Set(country.provinceIds);
    const front = country.provinceIds.filter((p) => land[p]?.some((q) => enemies.has(owners[q]!)));
    if (front.length === 0) continue;

    // How much enemy strength stands next to each front province, and how much of ours is there
    // or on the way.
    const threat = new Map<number, number>();
    for (const f of front) {
      let max = 0;
      for (const q of land[f] ?? []) {
        if (!enemies.has(owners[q]!)) continue;
        const enemy = (armiesIn.get(q) ?? [])
          .filter((a) => enemies.has(a.owner))
          .reduce((s, a) => s + armyStrength(rules, a), 0);
        max = Math.max(max, enemy);
      }
      threat.set(f, max);
    }
    const assigned = new Map<number, number>();
    const mine = state.military.armies.filter((a) => a.owner === country.id);
    const totalStrength = mine.reduce((sum, a) => sum + armyStrength(rules, a), 0);
    for (const a of mine) {
      const at = a.path.at(-1) ?? a.provinceId;
      assigned.set(at, (assigned.get(at) ?? 0) + armyStrength(rules, a));
    }
    const minGarrison = rules.ai.minGarrison;
    const need = (f: number): number =>
      Math.max(minGarrison, (threat.get(f) ?? 0) * rules.ai.frontCover);
    const deficit = (f: number): number => need(f) - (assigned.get(f) ?? 0);
    const send = (army: Army, to: number): boolean => {
      const path = findPath(state, ctx, country.id, army.provinceId, to);
      if (!path || path.length === 0) return false;
      army.path = path;
      const strength = armyStrength(rules, army);
      assigned.set(army.provinceId, (assigned.get(army.provinceId) ?? 0) - strength);
      assigned.set(to, (assigned.get(to) ?? 0) + strength);
      return true;
    };
    const neediest = (): number | undefined =>
      [...front].sort((x, y) => deficit(y) - deficit(x) || x - y).find((f) => deficit(f) > 0);

    const idle = mine
      .filter((a) => a.path.length === 0 && a.arriveTurn === undefined)
      .sort((x, y) => armyStrength(rules, y) - armyStrength(rules, x) || x.id - y.id);
    for (const army of idle) {
      const strength = armyStrength(rules, army);
      const targets = (land[army.provinceId] ?? [])
        .filter((q) => enemies.has(owners[q]!))
        .map((q) => ({ q, defense: defenseOf(q) }))
        .sort((x, y) => x.defense - y.defense || x.q - y.q);
      const best = targets[0];
      const onFront = threat.has(army.provinceId);
      // Attack with what the province can spare.
      const spare = onFront
        ? Math.max(0, (assigned.get(army.provinceId) ?? 0) - need(army.provinceId))
        : strength;
      if (best && Math.min(spare, strength) >= Math.max(1, best.defense) * rules.ai.attackRatio) {
        if (spare >= strength) {
          army.path = [best.q];
        } else {
          const part = splitOff(state, army, spare / strength, rules.ai.minDetachment);
          if (part) part.path = [best.q];
        }
        assigned.set(
          army.provinceId,
          (assigned.get(army.provinceId) ?? 0) - Math.min(spare, strength),
        );
        continue;
      }
      // The capital keeps a share of the army; a front province keeps what covers its threat.
      // The rest goes where the front needs it.
      const isCapital = army.provinceId === country.capitalProvinceId;
      if (isCapital || onFront) {
        const keep = Math.max(
          need(army.provinceId),
          isCapital ? rules.ai.capitalShare * totalStrength : 0,
        );
        const surplus = (assigned.get(army.provinceId) ?? 0) - keep;
        const target = neediest();
        if (target === undefined || surplus <= strength * 0.2 || target === army.provinceId)
          continue;
        const share = Math.min(1, Math.min(surplus, deficit(target)) / strength);
        const part = share >= 0.95 ? army : splitOff(state, army, share, rules.ai.minDetachment);
        if (part && !send(part, target) && part !== army) {
          army.regulars += part.regulars;
          army.special += part.special;
          part.regulars = part.special = 0;
        }
        continue;
      }
      const target =
        neediest() ??
        [...front].sort((x, y) => (assigned.get(x) ?? 0) - (assigned.get(y) ?? 0) || x - y)[0]!;
      if (own.has(target)) send(army, target);
    }
    state.military.armies = state.military.armies.filter((a) => a.regulars + a.special > 0);
  }
}

/** Splits a share of an army into a new army in the same province. */
function splitOff(state: GameState, army: Army, share: number, min: number): Army | null {
  const regulars = Math.floor(army.regulars * share);
  const special = Math.floor(army.special * share);
  // No tiny detachments: they clutter the map and achieve nothing.
  if (regulars + special < Math.max(1, min)) return null;
  army.regulars -= regulars;
  army.special -= special;
  const part: Army = { ...army, id: state.military.nextArmyId++, regulars, special, path: [] };
  state.military.armies.push(part);
  return part;
}

/**
 * At peace, a country whose budget is in deficit sends soldiers above the army it can pay for
 * in peacetime home to the reserves, a little every week.
 */
function demobilize(state: GameState, ctx: SimContext, countryId: string): void {
  const rules = militaryRules(ctx);
  const m = state.military.countries[countryId];
  const e = state.economy.countries[countryId];
  if (!m || !e || m.upkeepPerSoldier <= 0) return;
  // At peace a country pays for at most a peacetime share of its GDP.
  const share = Math.min(e.militaryShare, rules.ai.peaceMilitaryShare);
  const affordable = (e.gdp * share) / 52 / m.upkeepPerSoldier;
  const armies = state.military.armies.filter((a) => a.owner === countryId);
  const soldiers = armies.reduce((s, a) => s + a.regulars, 0);
  const excess = soldiers - affordable;
  if (excess <= 0 || weeklyBudget(state, countryId, ctx).balance >= 0) return;
  const sentShare = Math.min(excess, soldiers * rules.ai.demobilizeShare) / soldiers;
  for (const a of armies) {
    const sent = Math.floor(a.regulars * sentShare);
    a.regulars -= sent;
    if (state.world.provinceOwners[a.provinceId] === countryId)
      state.military.reservists[a.provinceId]! += sent;
  }
  state.military.armies = state.military.armies.filter((a) => a.regulars + a.special > 0);
}

/**
 * Air defense: a country at war, or one with a hostile neighbor or rival that has missiles,
 * builds or upgrades air defense in its capital and largest cities when it can afford it.
 */
function aiAirDefense(state: GameState, ctx: SimContext, id: string, atWar: boolean): void {
  const r = weaponsRules(ctx).ai.airDefense;
  if (!r || (state.turn + id.charCodeAt(0) + id.charCodeAt(1)) % r.everyTurns !== 0) return;
  const e = state.economy.countries[id];
  const country = state.world.countries.find((c) => c.id === id);
  if (!e || !country) return;
  const threatened =
    atWar ||
    state.world.countries.some((c) => {
      if (c.id === id || c.provinceIds.length === 0) return false;
      const w = state.weapons.countries[c.id];
      if (!w || !w.missiles.some((n) => n > 0)) return false;
      return relation(state, ctx, id, c.id) <= r.threatRelation;
    });
  if (!threatened) return;
  const sites = [
    country.capitalProvinceId,
    ...[...country.provinceIds]
      .sort(
        (a, b) => (ctx.provincePopulation?.[b] ?? 0) - (ctx.provincePopulation?.[a] ?? 0) || a - b,
      )
      .slice(0, r.sites),
  ]
    .map((p) => provinceSeat(ctx, p))
    .filter((c, i, all) => c >= 0 && all.indexOf(c) === i)
    .slice(0, r.sites);
  for (const cityId of sites) {
    const quote = airDefenseQuote(state, ctx, id, cityId);
    if (quote.allowed || !quote.level) continue;
    if (quote.level.costUsd > e.treasury * r.treasuryShare) continue;
    startAirDefense(state, ctx, id, cityId);
    return;
  }
}

/** Recruits part of the gap to the army the country can pay for at war. */
function recruit(state: GameState, ctx: SimContext, countryId: string): void {
  const rules = militaryRules(ctx);
  const m = state.military.countries[countryId];
  const e = state.economy.countries[countryId];
  if (!m || !e || m.upkeepPerSoldier <= 0) return;
  // A budget already deep in deficit (after foreign aid) pays for no more soldiers.
  const balance = weeklyBudget(state, countryId, ctx).balance + (e.aid ?? 0);
  if ((-balance * 52) / Math.max(1, e.gdp) > rules.ai.maxDeficitToRecruit) return;
  const affordable = (e.gdp * e.militaryShare) / 52 / m.upkeepPerSoldier;
  const t = militaryTotals(state, countryId);
  const gap = affordable * rules.ai.targetArmyAtWar - (t.regulars + t.special + t.trainees);
  if (gap <= 0) return;
  const want = Math.ceil(gap * rules.ai.recruitShareOfGap);
  const country = state.world.countries.find((c) => c.id === countryId)!;
  const cities = country.provinceIds
    .flatMap((p) => citiesOfProvince(ctx, p))
    .sort((a, b) => state.military.manpower[b]! - state.military.manpower[a]! || a - b)
    .slice(0, RECRUIT_CITIES);
  if (cities.length === 0) return;
  let quote = recruitQuote(
    state,
    ctx,
    countryId,
    cities,
    'regular',
    'fixed',
    Math.ceil(want / cities.length),
  );
  const budget = e.treasury * rules.ai.maxTreasuryShare;
  if (quote.cost > budget && quote.cost > 0 && budget > 0) {
    // Recruit what the treasury allows.
    const share = budget / quote.cost;
    quote = recruitQuote(
      state,
      ctx,
      countryId,
      cities,
      'regular',
      'fixed',
      Math.floor((want / cities.length) * share),
    );
  }
  if (quote.affordable && quote.cost <= e.treasury * rules.ai.maxTreasuryShare)
    startRecruitment(state, countryId, ctx, quote);
}

/**
 * AI use of missiles and drones in its wars: strikes on enemy armies near the front (or the enemy
 * capital), production when it has factories, and nuclear weapons only as a last resort when it is
 * about to lose the country (GDD section 9).
 */
export function aiWeaponsOrders(state: GameState, ctx: SimContext): void {
  const rules = weaponsRules(ctx);
  const owners = state.world.provinceOwners;
  const land = ctx.provinceNeighbors ?? [];
  const armyIn = new Map<number, number>();
  for (const a of state.military.armies)
    armyIn.set(a.provinceId, (armyIn.get(a.provinceId) ?? 0) + a.regulars + a.special);

  for (const country of state.world.countries) {
    if (country.id === state.player.countryId || country.provinceIds.length === 0) continue;
    const arsenal = state.weapons.countries[country.id];
    if (!arsenal) continue;
    const enemies = new Set(enemiesAtWar(state.world, country.id));
    if (country.status !== 'rebels') aiAirDefense(state, ctx, country.id, enemies.size > 0);
    if (enemies.size === 0) continue;

    // Targets: enemy provinces next to ours, biggest enemy armies first; then enemy capitals.
    const near = new Set<number>();
    for (const p of country.provinceIds)
      for (const q of land[p] ?? []) if (enemies.has(owners[q]!)) near.add(q);
    const targets = [...near]
      .filter((q) => (armyIn.get(q) ?? 0) > 0)
      .sort((a, b) => (armyIn.get(b) ?? 0) - (armyIn.get(a) ?? 0) || a - b);
    const capitals = state.world.countries
      .filter((c) => enemies.has(c.id) && c.provinceIds.length > 0)
      .map((c) => c.capitalProvinceId);
    const targetCities = [...targets, ...capitals]
      .map((p) => citiesOfProvince(ctx, p)[0])
      .filter((c): c is number => c !== undefined);

    // Last resort: the country is almost lost and the enemy stands at the capital.
    const nearlyLost =
      country.provinceIds.length <= arsenal.startProvinces * rules.nuclear.aiLastResortShare;
    const capitalThreatened = [
      country.capitalProvinceId,
      ...(land[country.capitalProvinceId] ?? []),
    ].some((p) => state.military.armies.some((a) => a.provinceId === p && enemies.has(a.owner)));
    const posture = ctx.aiRules ? trait(state, ctx, country.id, 'nuclear') : 100;
    const willing = posture >= (ctx.aiRules?.nuclear.lastResortMinPosture ?? 0);
    // Never on rebels (its own people), and at most once per cooldown.
    const cooled =
      state.turn - (arsenal.lastNuclearTurn ?? -Infinity) >= (rules.nuclear.aiCooldownTurns ?? 0);
    if (arsenal.warheads > 0 && nearlyLost && capitalThreatened && willing && cooled) {
      const capital = state.world.countries.find(
        (c) => enemies.has(c.id) && c.status !== 'rebels' && c.provinceIds.length > 0,
      )?.capitalProvinceId;
      const city = capital !== undefined ? citiesOfProvince(ctx, capital)[0] : undefined;
      if (city !== undefined && !launchNuclear(state, ctx, country.id, city))
        arsenal.lastNuclearTurn = state.turn;
    }

    for (let tier = rules.missiles.length; tier >= 1; tier--) {
      const stock = arsenal.missiles[tier - 1] ?? 0;
      if (stock <= 0) continue;
      const count = Math.min(
        rules.ai.missileMax,
        Math.max(1, Math.floor(stock * rules.ai.missileShare)),
      );
      const range = rules.missiles[tier - 1]!.rangeKm;
      const city = targetCities.find((c) => launchSiteFor(state, ctx, country.id, c, range) >= 0);
      if (city !== undefined) launchMissiles(state, ctx, country.id, city, tier, count);
    }
    for (let tier = rules.drones.length; tier >= 1; tier--) {
      const stock = arsenal.drones[tier - 1] ?? 0;
      if (stock <= 0) continue;
      const count = Math.min(
        rules.ai.droneMax,
        Math.max(1, Math.floor(stock * rules.ai.droneShare)),
      );
      for (const p of targets) {
        if (!launchDrones(state, ctx, country.id, p, tier, count)) break;
      }
    }

    // Keep producing the best missiles it can make with a share of the treasury.
    const e = state.economy.countries[country.id];
    if (e && !state.weapons.production.some((p) => p.owner === country.id)) {
      const tier = arsenal.tech[0];
      const cost = rules.missiles[tier - 1]?.costUsd ?? 0;
      const count =
        cost > 0 ? Math.floor((e.treasury * rules.ai.productionTreasuryShare) / cost) : 0;
      if (count > 0 && !productionQuote(state, ctx, country.id, 'missile', tier, count).allowed)
        startProduction(state, ctx, country.id, 'missile', tier, count);
    }
  }
}

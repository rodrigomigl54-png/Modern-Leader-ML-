// Simple AI orders until the real AI with country profiles (Phase 11): countries at war recruit
// toward the army they can pay for, move armies to the front and attack weak neighboring enemy
// provinces. Countries at peace keep their armies where they are. Turn step 1 (GDD section 5).
import type { SimContext } from './economy';
import {
  armyStrength,
  citiesOfProvince,
  findPath,
  militaryRules,
  militaryTotals,
  provinceBaseLevel,
  recruitQuote,
  startRecruitment,
  type Army,
} from './military';
import type { GameState } from './newGame';
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
    if (enemies.size === 0) continue;

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
      // The capital's garrison stays home.
      if (army.provinceId === country.capitalProvinceId) continue;
      if (onFront) {
        // Send the surplus to a front province that needs it.
        const surplus = (assigned.get(army.provinceId) ?? 0) - need(army.provinceId);
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

/** Recruits part of the gap to the army the country can pay for at war. */
function recruit(state: GameState, ctx: SimContext, countryId: string): void {
  const rules = militaryRules(ctx);
  const m = state.military.countries[countryId];
  const e = state.economy.countries[countryId];
  if (!m || !e || m.upkeepPerSoldier <= 0) return;
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

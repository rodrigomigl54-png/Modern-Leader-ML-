// Trade requests (Dario, Phase 26, after Age of History): the player offers a package to another
// country and asks for one in return: money, provinces, a war against a third country, sanctions
// on one (a coalition), military access, a defense pact or a non-aggression pact. The AI weighs
// what it gains against what it gives, adjusted by relations; a positive balance is accepted.
// Weights are in data/modern/diplomacy-rules.json ("deals").
import {
  addSanctions,
  diplomacyRules,
  exists,
  grantAccess,
  hasAccess,
  power,
  relation,
  sanctioned,
  startWar,
  type ActionResult,
} from './diplomacy';
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { transferProvince } from './population';
import { alliesOf, enemiesAtWar, rivalsOf } from './world';

/** What one side of a deal gives. */
export interface DealSide {
  money?: number;
  provinces?: number[];
  /** This side declares war on the country. */
  declareWarOn?: string;
  /** This side sanctions the country (a coalition against it). */
  sanctionsOn?: string;
  /** This side lets the other's armies cross its land. */
  militaryAccess?: boolean;
}

export interface Deal {
  /** What the proposer gives. */
  give: DealSide;
  /** What the proposer asks for. */
  take: DealSide;
  /** Both sides sign a defense pact or a non-aggression pact. */
  defensePact?: boolean;
  nonAggression?: boolean;
}

export interface DealRules {
  /** Points per 1% of the receiver's GDP in money. */
  moneyPerGdpPercent: number;
  /** Points per 1% of the receiver's population in land (gained), times giveLandFactor when lost. */
  landPerPopulationPercent: number;
  giveLandFactor: number;
  /** Going to war: base cost, plus this per unit of the enemy's strength against ours. */
  warBase: number;
  warPerPowerRatio: number;
  /** A war the receiver wanted anyway (relation at most hostileRelation) costs less. */
  hostileRelation: number;
  hostileBonus: number;
  sanctionsCost: number;
  accessCost: number;
  accessGain: number;
  /** Pacts: worth (relation - pactRelation) / pactDivisor. */
  pactDivisor: number;
  nonAggressionBase: number;
  /** Relation adds relation / relationDivisor; scores above highAt are "high" likelihood. */
  relationDivisor: number;
  highAt: number;
  /** A non-aggression pact lasts this many turns. */
  nonAggressionTurns: number;
  /** Relation change for each side after an accepted deal. */
  acceptedRelation: number;
}

export type Likelihood = 'veryLow' | 'low' | 'medium' | 'high';

export function dealRules(ctx: SimContext): DealRules {
  const r = diplomacyRules(ctx).deals;
  if (!r) throw new Error('Deal rules missing from diplomacy-rules.json');
  return r;
}

/** True while a non-aggression pact between the two holds. */
export function nonAggressionBetween(state: GameState, a: string, b: string): boolean {
  return (state.diplomacy.nonAggression ?? []).some(
    (p) => p.until >= state.turn && ((p.a === a && p.b === b) || (p.a === b && p.b === a)),
  );
}

function populationShare(state: GameState, ctx: SimContext, id: string, provinces: number[]) {
  const total =
    state.world.countries
      .find((c) => c.id === id)
      ?.provinceIds.reduce((s, p) => s + (ctx.provincePopulation?.[p] ?? 0), 0) ?? 0;
  const part = provinces.reduce((s, p) => s + (ctx.provincePopulation?.[p] ?? 0), 0);
  return total > 0 ? part / total : 0;
}

/** Why a deal cannot be made at all, or null when it is valid. */
export function dealError(
  state: GameState,
  from: string,
  to: string,
  deal: Deal,
): ActionResult | null {
  if (!exists(state, to) || from === to) return { error: 'invalidTarget' };
  if (enemiesAtWar(state.world, from).includes(to)) return { error: 'atWar' };
  const sides: [string, string, DealSide][] = [
    [from, to, deal.give],
    [to, from, deal.take],
  ];
  for (const [giver, other, side] of sides) {
    const e = state.economy.countries[giver];
    if ((side.money ?? 0) < 0 || (side.money ?? 0) > (e?.treasury ?? 0))
      return { error: 'notEnoughMoney' };
    const country = state.world.countries.find((c) => c.id === giver);
    for (const p of side.provinces ?? [])
      if (state.world.provinceOwners[p] !== giver || p === country?.capitalProvinceId)
        return { error: 'invalidTarget' };
    // Only countries both can reach as enemies: never one of the two, nor an ally of the giver.
    for (const x of [side.declareWarOn, side.sanctionsOn])
      if (x && (x === giver || x === other || !exists(state, x))) return { error: 'invalidTarget' };
    if (side.declareWarOn && alliesOf(state.world, giver).includes(side.declareWarOn))
      return { error: 'alreadyAllied' };
  }
  const empty = (s: DealSide): boolean =>
    !s.money && !s.provinces?.length && !s.declareWarOn && !s.sanctionsOn && !s.militaryAccess;
  if (empty(deal.give) && empty(deal.take) && !deal.defensePact && !deal.nonAggression)
    return { error: 'invalidTarget' };
  return null;
}

/** How much the receiver (to) gains from a deal, in points; positive means it accepts. */
export function dealScore(
  state: GameState,
  ctx: SimContext,
  from: string,
  to: string,
  deal: Deal,
): number {
  const r = dealRules(ctx);
  const pactRelation = diplomacyRules(ctx).alliance.pactMinRelation;
  const gdp = Math.max(1, state.economy.countries[to]?.gdp ?? 1);
  const rel = relation(state, ctx, to, from);
  const strength = (x: string): number => Math.max(1, power(state, ctx, x));
  let score = rel / r.relationDivisor;
  // What the receiver gets.
  score += ((deal.give.money ?? 0) / gdp) * 100 * r.moneyPerGdpPercent;
  score +=
    populationShare(state, ctx, from, deal.give.provinces ?? []) *
    100 *
    r.landPerPopulationPercent *
    // Land of another country counts by its people, relative to the receiver's size.
    (strength(from) / strength(to)) ** 0.25;
  if (deal.give.declareWarOn && relation(state, ctx, to, deal.give.declareWarOn) < 0)
    score += r.hostileBonus;
  if (deal.give.sanctionsOn && relation(state, ctx, to, deal.give.sanctionsOn) < 0)
    score += r.sanctionsCost / 2;
  if (deal.give.militaryAccess) score += r.accessGain;
  // What the receiver gives.
  score -= ((deal.take.money ?? 0) / gdp) * 100 * r.moneyPerGdpPercent;
  score -=
    populationShare(state, ctx, to, deal.take.provinces ?? []) *
    100 *
    r.landPerPopulationPercent *
    r.giveLandFactor;
  if (deal.take.declareWarOn) {
    const enemy = deal.take.declareWarOn;
    let cost = r.warBase + r.warPerPowerRatio * (strength(enemy) / strength(to));
    if (
      relation(state, ctx, to, enemy) <= r.hostileRelation ||
      rivalsOf(state.world, to).includes(enemy)
    )
      cost -= r.hostileBonus;
    score -= Math.max(0, cost);
  }
  if (deal.take.sanctionsOn && !sanctioned(state, to, deal.take.sanctionsOn))
    score -=
      relation(state, ctx, to, deal.take.sanctionsOn) < 0 ? r.sanctionsCost / 2 : r.sanctionsCost;
  if (deal.take.militaryAccess) score -= r.accessCost;
  // Mutual treaties.
  if (deal.defensePact) score += (rel - pactRelation) / r.pactDivisor;
  if (deal.nonAggression)
    score += r.nonAggressionBase * (strength(from) > strength(to) ? 2 : rel < -50 ? -1 : 1);
  return score;
}

/** The chance of acceptance, as players see it. */
export function dealLikelihood(score: number, rules: DealRules): Likelihood {
  return score >= rules.highAt
    ? 'high'
    : score >= 0
      ? 'medium'
      : score >= -rules.highAt
        ? 'low'
        : 'veryLow';
}

/** Carries out one side of an accepted deal. */
function apply(state: GameState, ctx: SimContext, giver: string, other: string, side: DealSide) {
  const money = side.money ?? 0;
  if (money > 0) {
    state.economy.countries[giver]!.treasury -= money;
    state.economy.countries[other]!.treasury += money;
  }
  for (const p of side.provinces ?? []) transferProvince(state, ctx, p, other);
  if (side.militaryAccess && !hasAccess(state, other, giver)) grantAccess(state, giver, other);
  if (side.sanctionsOn && !sanctioned(state, giver, side.sanctionsOn))
    addSanctions(state, ctx, giver, side.sanctionsOn);
  if (side.declareWarOn && !enemiesAtWar(state.world, giver).includes(side.declareWarOn))
    startWar(state, ctx, giver, side.declareWarOn);
}

/** The player's (or any country's) trade request to an AI country. */
export function proposeDeal(
  state: GameState,
  ctx: SimContext,
  from: string,
  to: string,
  deal: Deal,
): ActionResult {
  const invalid = dealError(state, from, to, deal);
  if (invalid) return invalid;
  const rules = diplomacyRules(ctx);
  const have = state.diplomacy.points[from] ?? 0;
  const cost = rules.costs.deal ?? 0;
  if (have + 1e-9 < cost) return { error: 'notEnoughPoints' };
  state.diplomacy.points[from] = have - cost;
  const accepted = to !== state.player.countryId && dealScore(state, ctx, from, to, deal) >= 0;
  if (!accepted) return { accepted };
  const r = dealRules(ctx);
  apply(state, ctx, from, to, deal.give);
  apply(state, ctx, to, from, deal.take);
  if (deal.defensePact && !alliesOf(state.world, from).includes(to))
    state.world.alliances.push({
      id: `pact-${state.turn}-${from}-${to}`,
      type: 'pact',
      members: [from, to],
    });
  if (deal.nonAggression)
    (state.diplomacy.nonAggression ??= []).push({
      a: from,
      b: to,
      until: state.turn + r.nonAggressionTurns,
    });
  const key = from < to ? `${from}|${to}` : `${to}|${from}`;
  state.diplomacy.relations[key] = Math.max(
    -100,
    Math.min(100, relation(state, ctx, from, to) + r.acceptedRelation),
  );
  return { accepted };
}

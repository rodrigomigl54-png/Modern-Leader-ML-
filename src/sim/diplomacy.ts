// Diplomacy (GDD sections 5, 8 and 10): relations, diplomatic points, credibility, alliances and
// pacts, sanctions, ultimatums, joining wars, foreign bases, aid, weapons trade, vassals and peace
// treaties. Until AI profiles exist (Phase 11) AI answers follow the thresholds in
// data/modern/diplomacy-rules.json (DiplomacyRules). Everything is deterministic.
import type { SimContext } from './economy';
import { armyStrength, militaryRules, provinceSeat } from './military';
import type { GameState } from './newGame';
import { joinThreshold } from './profiles';
import { transferProvince } from './population';
import type { TurnEvent } from './turn';
import { weaponsRules, type WeaponKind } from './weapons';
import { alliesOf, enemiesAtWar, rivalsOf, type War, type World } from './world';

export interface DiplomacyRules {
  relations: {
    alliance: number;
    pact: number;
    vassal: number;
    rival: number;
    war: number;
    driftPerTurn: number;
  };
  points: { base: number; gdpCap: number; capTurns: number; credibilityWeight: number };
  costs: {
    ultimatum: number;
    sanction: number;
    alliance: number;
    base: number;
    vassal: number;
    aid: number;
  };
  credibility: { start: number; enforced: number; failed: number; enforceTurns: number };
  ultimatum: {
    deadlineTurns: number;
    threatWeight: Record<Threat, number>;
    demandCost: Record<Demand['type'], number>;
    refusedRelation: number;
    acceptedRelation: number;
    /** Sanctions threat strength per share of the world economy. */
    sanctionsGdpFactor: number;
  };
  sanctions: {
    relation: number;
    targetAlliesRelation: number;
    senderRivalsRelation: number;
    growthPerWorldShare: number;
    maxGrowthPenalty: number;
  };
  war: {
    declaredRelation: number;
    targetAlliesRelation: number;
    joinAllianceMinRelation: number;
    joinPactMinRelation: number;
    joinMaxRelationWithAttacker: number;
    refusedJoinRelation: number;
    requestTurns: number;
  };
  aid: { relationPerGdpShare: number; maxRelation: number; enemyRelation: number };
  trade: { markup: number; sellShare: number; minRelation: number; buyMinRelation: number };
  base: {
    askMinRelation: number;
    payMinRelation: number;
    priceShareOfHostGdp: number;
    minPriceUsd: number;
    removeBelowRelation: number;
  };
  vassal: {
    tributeShare: number;
    askPowerRatio: number;
    askMinRelation: number;
    offerMinRelation: number;
    transferMinRelation: number;
  };
  alliance: { pactMinRelation: number; joinMinRelation: number };
  peace: {
    capturePoints: number;
    battlePoints: number;
    strikePointsPer10k: number;
    wearinessPerTurn: number;
    maxWeariness: number;
    /** Weeks of war before peace can be proposed. */
    minTurns: number;
    reparationsCost: number;
    maxReparationsShare: number;
    vassalCost: number;
    demilitarizeCost: number;
    demilitarizeTurns: number;
    aiPeaceScore: number;
    aiPeaceMinTurns: number;
    aiStalemateTurns: number;
    aiOfferEvery: number;
    peaceRelation: number;
  };
  nuclear: { relation: number; alliesRelation: number };
}

/** Documented starting relations that replace the value from alliances and rivalries. */
export interface RelationOverride {
  a: string;
  b: string;
  value: number;
}

export type Threat = 'war' | 'sanctions' | 'leaveAlliance';

export type Demand =
  | { type: 'province'; provinceId: number }
  | { type: 'leaveAlliance'; allianceId: string }
  | { type: 'liftSanctions' }
  | { type: 'tribute'; amountUsd: number }
  | { type: 'vassal' }
  | { type: 'base'; cityId: number };

export interface Ultimatum {
  id: number;
  from: string;
  to: string;
  demand: Demand;
  threat: Threat;
  sentTurn: number;
  deadline: number;
  status: 'pending' | 'accepted' | 'refused' | 'enforced' | 'failed';
  /** After a refusal: the sender must carry out the threat by this turn. */
  enforceBy?: number;
}

export interface PeaceTerms {
  /** The proposer keeps the target's provinces it holds. */
  keepProvinces: boolean;
  /** The target returns the proposer's provinces it holds. */
  returnProvinces: boolean;
  /** Lump sum as a share of the target's GDP. */
  reparationsShare: number;
  vassal: boolean;
  /** The target may not keep armies in its provinces next to the proposer. */
  demilitarize: boolean;
}

export const WHITE_PEACE: PeaceTerms = {
  keepProvinces: true,
  returnProvinces: false,
  reparationsShare: 0,
  vassal: false,
  demilitarize: false,
};

/** Something the player has to answer (GDD section 12: delivered as ministers' messages). */
export type PlayerRequest =
  | { id: number; type: 'joinWar'; from: string; enemy: string; warId: string; until: number }
  | { id: number; type: 'peace'; from: string; warId: string; terms: PeaceTerms; until: number }
  | { id: number; type: 'ultimatum'; ultimatumId: number; until: number }
  | {
      id: number;
      type: 'investment';
      from: string;
      cityId: number;
      category: string;
      until: number;
    };

export interface WarRecord {
  startTurn: number;
  /** Points gained by side 0 and side 1. */
  gain: [number, number];
  /** Inhabitants of each country when the war began (for province value). */
  startPopulation: Record<string, number>;
  lastOffer: number;
  /** A nuclear threat was made in this war. */
  threatened?: boolean;
}

export interface DiplomacyState {
  /** Relations that differ from their baseline, keyed "A|B" (sorted). */
  relations: Record<string, number>;
  points: Record<string, number>;
  credibility: Record<string, number>;
  sanctions: { from: string; to: string; since: number }[];
  ultimatums: Ultimatum[];
  requests: PlayerRequest[];
  wars: Record<string, WarRecord>;
  demilitarized: { country: string; provinceIds: number[]; until: number }[];
  nextId: number;
}

export type DiplomacyEvent =
  | { type: 'warJoined'; countryId: string; warId: string; ally: string; enemy: string }
  | { type: 'peace'; a: string; b: string }
  | { type: 'ultimatumAnswered'; ultimatumId: number; from: string; to: string; accepted: boolean }
  | { type: 'credibilityLost'; countryId: string }
  | { type: 'request'; requestId: number }
  | { type: 'globalSanctions'; countryId: string };

export type DiplomacyError =
  | 'notEnoughPoints'
  | 'refused'
  | 'invalidTarget'
  | 'alreadyAllied'
  | 'sanctioned'
  | 'notSanctioned'
  | 'atWar'
  | 'notAtWar'
  | 'noStock'
  | 'notEnoughMoney'
  | 'unknownRequest'
  | 'tooEarly';

/** Result of a diplomatic action: its error, or whether the other side accepted. */
export type ActionResult = { error: DiplomacyError } | { accepted: boolean };

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function diplomacyRules(ctx: SimContext): DiplomacyRules {
  if (!ctx.diplomacy) throw new Error('Diplomacy rules missing from the simulation context');
  return ctx.diplomacy;
}

// ---- Relations ----

/** Relation implied by alliances, pacts, vassals, rivalries and wars. */
export function baselineRelation(
  world: World,
  rules: DiplomacyRules,
  a: string,
  b: string,
): number {
  if (a === b) return 100;
  if (enemiesAtWar(world, a).includes(b)) return rules.relations.war;
  let value = 0;
  for (const al of world.alliances) {
    if (!al.members.includes(a) || !al.members.includes(b)) continue;
    value = Math.max(value, rules.relations[al.type]);
  }
  if (rivalsOf(world, a).includes(b)) value = Math.min(value, rules.relations.rival);
  return value;
}

export function relation(state: GameState, ctx: SimContext, a: string, b: string): number {
  if (a === b) return 100;
  const stored = state.diplomacy?.relations[key(a, b)];
  if (stored !== undefined) return stored;
  return ctx.diplomacy ? baselineRelation(state.world, ctx.diplomacy, a, b) : 0;
}

export function changeRelation(
  state: GameState,
  ctx: SimContext,
  a: string,
  b: string,
  delta: number,
): void {
  if (a === b || delta === 0) return;
  state.diplomacy.relations[key(a, b)] = clamp(relation(state, ctx, a, b) + delta, -100, 100);
}

// ---- Setup ----

export function emptyDiplomacy(): DiplomacyState {
  return {
    relations: {},
    points: {},
    credibility: {},
    sanctions: [],
    ultimatums: [],
    requests: [],
    wars: {},
    demilitarized: [],
    nextId: 1,
  };
}

const populationOf = (state: Pick<GameState, 'world'>, ctx: SimContext, id: string): number =>
  (state.world.countries.find((c) => c.id === id)?.provinceIds ?? []).reduce(
    (s, p) => s + (ctx.provincePopulation?.[p] ?? 0),
    0,
  );

function warRecord(state: Pick<GameState, 'world' | 'turn'>, ctx: SimContext, war: War): WarRecord {
  const startPopulation: Record<string, number> = {};
  for (const id of [...war.sides[0], ...war.sides[1]])
    startPopulation[id] = populationOf(state, ctx, id);
  return { startTurn: state.turn, gain: [0, 0], startPopulation, lastOffer: state.turn };
}

/** Starting relations, points and credibility (GDD section 10: real relations at the start). */
export function initDiplomacy(
  state: Pick<GameState, 'world' | 'turn'> & Partial<Pick<GameState, 'economy'>>,
  ctx: SimContext,
): DiplomacyState {
  const rules = diplomacyRules(ctx);
  const d = emptyDiplomacy();
  const ids = new Set(state.world.countries.map((c) => c.id));
  for (const o of ctx.relationOverrides ?? []) {
    if (ids.has(o.a) && ids.has(o.b)) d.relations[key(o.a, o.b)] = clamp(o.value, -100, 100);
  }
  for (const c of state.world.countries) {
    d.credibility[c.id] = rules.credibility.start;
    // Countries start with full points (three turns of income).
    const gdp = state.economy?.countries[c.id]?.gdp ?? 0;
    const size = clamp(Math.log10(Math.max(1, gdp) / 1e10), 0, rules.points.gdpCap);
    const credibility =
      1 -
      rules.points.credibilityWeight +
      (rules.points.credibilityWeight * rules.credibility.start) / 100;
    d.points[c.id] = (rules.points.base + size) * credibility * rules.points.capTurns;
  }
  for (const s of ctx.startSanctions ?? []) {
    if (
      ids.has(s.from) &&
      ids.has(s.to) &&
      !d.sanctions.some((x) => x.from === s.from && x.to === s.to)
    )
      d.sanctions.push({ from: s.from, to: s.to, since: 0 });
  }
  for (const w of state.world.wars) d.wars[w.id] = warRecord(state, ctx, w);
  return d;
}

/** Adds diplomacy to games saved before Phase 9. */
export function ensureDiplomacy(state: GameState, ctx: SimContext): GameState {
  if (state.diplomacy || !ctx.diplomacy) return state;
  return { ...state, diplomacy: initDiplomacy(state, ctx) };
}

// ---- Points, power, sanctions ----

/** Diplomatic points earned per turn: size and reputation (GDD section 5). */
export function pointsIncome(state: GameState, ctx: SimContext, id: string): number {
  const rules = diplomacyRules(ctx).points;
  const gdp = state.economy.countries[id]?.gdp ?? 0;
  const size = clamp(Math.log10(Math.max(1, gdp) / 1e10), 0, rules.gdpCap);
  const credibility = state.diplomacy.credibility[id] ?? 50;
  return (
    (rules.base + size) *
    (1 - rules.credibilityWeight + (rules.credibilityWeight * credibility) / 100)
  );
}

export function pointsCap(state: GameState, ctx: SimContext, id: string): number {
  return pointsIncome(state, ctx, id) * diplomacyRules(ctx).points.capTurns;
}

function spend(state: GameState, id: string, cost: number): boolean {
  const have = state.diplomacy.points[id] ?? 0;
  if (have + 1e-9 < cost) return false;
  state.diplomacy.points[id] = have - cost;
  return true;
}

/** Military strength of a country (armies, and reservists at half). */
export function power(state: GameState, ctx: SimContext, id: string): number {
  if (!ctx.military) return 0;
  const rules = militaryRules(ctx);
  let total = 0;
  for (const a of state.military.armies) if (a.owner === id) total += armyStrength(rules, a);
  const country = state.world.countries.find((c) => c.id === id);
  for (const p of country?.provinceIds ?? []) total += (state.military.reservists[p] ?? 0) * 0.5;
  return total;
}

/** Own strength plus half of the allies' strength. */
function sidePower(state: GameState, ctx: SimContext, id: string, except?: string): number {
  return (
    power(state, ctx, id) +
    0.5 *
      alliesOf(state.world, id)
        .filter((a) => a !== except)
        .reduce((s, a) => s + power(state, ctx, a), 0)
  );
}

export function sanctioned(state: GameState, from: string, to: string): boolean {
  return state.diplomacy?.sanctions.some((s) => s.from === from && s.to === to) ?? false;
}

/** Sanctions in either direction (they block trade, weapons sales and investment). */
export function sanctionsBetween(state: GameState, a: string, b: string): boolean {
  return sanctioned(state, a, b) || sanctioned(state, b, a);
}

function worldGdp(state: GameState): number {
  return Object.values(state.economy.countries).reduce((s, e) => s + e.gdp, 0) || 1;
}

/** Per-turn cache of sanction weights (they are read for every province). */
let weightCache: { state: GameState; turn: number; weights: Map<string, number> } | null = null;

/** Share of the world economy that sanctions a country. */
export function sanctionWeight(state: GameState, id: string): number {
  if (!state.diplomacy) return 0;
  if (weightCache?.state !== state || weightCache.turn !== state.turn) {
    const total = worldGdp(state);
    const weights = new Map<string, number>();
    for (const s of state.diplomacy.sanctions)
      weights.set(
        s.to,
        (weights.get(s.to) ?? 0) + (state.economy.countries[s.from]?.gdp ?? 0) / total,
      );
    weightCache = { state, turn: state.turn, weights };
  }
  return weightCache.weights.get(id) ?? 0;
}

/** Annual growth lost to sanctions (GDD section 10). */
export function sanctionsGrowthPenalty(state: GameState, ctx: SimContext, id: string): number {
  if (!ctx.diplomacy || !state.diplomacy) return 0;
  const r = ctx.diplomacy.sanctions;
  return Math.min(r.maxGrowthPenalty, sanctionWeight(state, id) * r.growthPerWorldShare);
}

// ---- Wars ----

/** Index of the side a country fights on in a war, or -1. */
const sideOf = (war: War, id: string): number =>
  war.sides[0].includes(id) ? 0 : war.sides[1].includes(id) ? 1 : -1;

function addToWar(state: GameState, war: War, side: number, id: string): void {
  if (sideOf(war, id) >= 0) return;
  war.sides[side]!.push(id);
  const record = state.diplomacy.wars[war.id];
  if (record && record.startPopulation[id] === undefined) record.startPopulation[id] = 0;
}

/**
 * Starts a war (GDD section 8): relations fall, vassals follow their overlords, and allies of
 * the attacked country decide whether to join. The player's allies are asked.
 */
export function startWar(
  state: GameState,
  ctx: SimContext,
  attacker: string,
  target: string,
  emit: (e: DiplomacyEvent) => void = () => undefined,
): War {
  const war: War = { id: `war-${state.turn}-${attacker}-${target}`, sides: [[attacker], [target]] };
  state.world.wars.push(war);
  if (!ctx.diplomacy || !state.diplomacy) return war;
  const rules = ctx.diplomacy;
  state.diplomacy.wars[war.id] = warRecord(state, ctx, war);
  changeRelation(state, ctx, attacker, target, rules.war.declaredRelation);
  for (const ally of alliesOf(state.world, target))
    changeRelation(state, ctx, attacker, ally, rules.war.targetAlliesRelation);

  const vassalsOf = (id: string): string[] =>
    state.world.alliances
      .filter((a) => a.type === 'vassal' && a.members[0] === id)
      .map((a) => a.members[1]!);
  for (const v of vassalsOf(attacker)) if (v !== target) addToWar(state, war, 0, v);

  // Defenders: vassals and overlords always, alliance and pact members by their relations.
  const defenders = new Set<string>();
  for (const al of state.world.alliances) {
    if (!al.members.includes(target)) continue;
    for (const m of al.members) {
      if (m === target || m === attacker || sideOf(war, m) >= 0 || defenders.has(m)) continue;
      if (alliesOf(state.world, attacker).includes(m)) continue;
      if (al.type === 'vassal') {
        defenders.add(m);
        continue;
      }
      // Alliance loyalty from the AI profile decides how friendly the member must be.
      const min =
        joinThreshold(state, ctx, m, al.type) ??
        (al.type === 'alliance'
          ? rules.war.joinAllianceMinRelation
          : rules.war.joinPactMinRelation);
      if (relation(state, ctx, m, target) < min) continue;
      if (relation(state, ctx, m, attacker) > rules.war.joinMaxRelationWithAttacker) continue;
      defenders.add(m);
    }
  }
  for (const m of [...defenders].sort()) {
    if (m === state.player.countryId) {
      const request: PlayerRequest = {
        id: state.diplomacy.nextId++,
        type: 'joinWar',
        from: target,
        enemy: attacker,
        warId: war.id,
        until: state.turn + rules.war.requestTurns,
      };
      state.diplomacy.requests.push(request);
      emit({ type: 'request', requestId: request.id });
      continue;
    }
    addToWar(state, war, 1, m);
    changeRelation(state, ctx, m, attacker, rules.war.declaredRelation);
    emit({ type: 'warJoined', countryId: m, warId: war.id, ally: target, enemy: attacker });
  }
  return war;
}

/** War score of a country in a war (-100 losing, +100 winning). */
export function warScore(state: GameState, warId: string, id: string): number {
  const war = state.world.wars.find((w) => w.id === warId);
  const record = state.diplomacy?.wars[warId];
  if (!war || !record) return 0;
  const side = sideOf(war, id);
  if (side < 0) return 0;
  return clamp(record.gain[side]! - record.gain[1 - side]!, -100, 100);
}

/** The war between two countries, if any. */
export function warBetween(world: World, a: string, b: string): War | undefined {
  return world.wars.find((w) => {
    const sa = sideOf(w, a);
    const sb = sideOf(w, b);
    return sa >= 0 && sb >= 0 && sa !== sb;
  });
}

const culture = (state: GameState, p: number): string =>
  state.population?.culture[p] ?? state.world.provinceOwners[p]!;

function provinceValue(
  state: GameState,
  ctx: SimContext,
  record: WarRecord | undefined,
  p: number,
): number {
  const rules = diplomacyRules(ctx).peace;
  const owner = culture(state, p);
  const total = record?.startPopulation[owner] || populationOf(state, ctx, owner) || 1;
  return (rules.capturePoints * (ctx.provincePopulation?.[p] ?? 0)) / total;
}

export interface PeaceCost {
  /** Score the proposer's demands cost. */
  cost: number;
  /** Score the proposer has to spend: its war score plus war weariness of the target. */
  available: number;
  keep: number[];
  give: number[];
  reparations: number;
}

/** What a peace proposal costs in war score (GDD section 8: demands are capped by the score). */
export function peaceCost(
  state: GameState,
  ctx: SimContext,
  proposer: string,
  target: string,
  terms: PeaceTerms,
): PeaceCost | null {
  const rules = diplomacyRules(ctx).peace;
  const war = warBetween(state.world, proposer, target);
  if (!war) return null;
  const record = state.diplomacy.wars[war.id];
  const owners = state.world.provinceOwners;
  const keep = owners
    .map((o, p) => (o === proposer && culture(state, p) === target ? p : -1))
    .filter((p) => p >= 0);
  const give = owners
    .map((o, p) => (o === target && culture(state, p) === proposer ? p : -1))
    .filter((p) => p >= 0);
  const value = (ps: number[]): number =>
    ps.reduce((s, p) => s + provinceValue(state, ctx, record, p), 0);
  const gdp = state.economy.countries[target]?.gdp ?? 0;
  const share = clamp(terms.reparationsShare, 0, rules.maxReparationsShare);
  // Each side keeps by default what it holds: keeping is the proposer's gain, leaving our land
  // with the target is the target's gain.
  let cost = (terms.keepProvinces ? value(keep) : 0) - (terms.returnProvinces ? 0 : value(give));
  cost += share * rules.reparationsCost;
  if (terms.vassal) cost += rules.vassalCost;
  if (terms.demilitarize) cost += rules.demilitarizeCost;
  const turns = state.turn - (record?.startTurn ?? state.turn);
  const weariness = Math.min(rules.maxWeariness, turns * rules.wearinessPerTurn);
  return {
    cost,
    available: warScore(state, war.id, proposer) + weariness,
    keep: terms.keepProvinces ? keep : [],
    give: terms.returnProvinces ? give : [],
    reparations: share * gdp,
  };
}

/** Ends the war between two countries on the given terms (the target leaves the war). */
export function applyPeace(
  state: GameState,
  ctx: SimContext,
  proposer: string,
  target: string,
  terms: PeaceTerms,
  emit: (e: DiplomacyEvent) => void = () => undefined,
): void {
  const rules = diplomacyRules(ctx).peace;
  const cost = peaceCost(state, ctx, proposer, target, terms);
  const war = warBetween(state.world, proposer, target);
  if (!cost || !war) return;
  // Provinces not kept go back to the people who live there.
  const owners = state.world.provinceOwners;
  owners.forEach((o, p) => {
    if (o === proposer && culture(state, p) === target && !cost.keep.includes(p))
      transferProvince(state, ctx, p, target);
  });
  for (const p of cost.give) transferProvince(state, ctx, p, proposer);
  if (cost.reparations > 0) {
    const from = state.economy.countries[target];
    const to = state.economy.countries[proposer];
    if (from && to) {
      // Paid from the treasury; what is missing becomes debt.
      const paid = Math.min(from.treasury, cost.reparations);
      from.treasury -= paid;
      from.debt += cost.reparations - paid;
      to.treasury += cost.reparations;
    }
  }
  if (terms.vassal) makeVassal(state, proposer, target);
  if (terms.demilitarize) {
    const land = ctx.provinceNeighbors ?? [];
    const country = state.world.countries.find((c) => c.id === target);
    const border = (country?.provinceIds ?? []).filter((p) =>
      land[p]?.some((q) => owners[q] === proposer),
    );
    state.diplomacy.demilitarized.push({
      country: target,
      provinceIds: border,
      until: state.turn + rules.demilitarizeTurns,
    });
    // Armies there go home.
    for (const a of state.military.armies)
      if (a.owner === target && border.includes(a.provinceId)) {
        const capital = country?.capitalProvinceId;
        if (capital !== undefined && !border.includes(capital)) {
          a.provinceId = capital;
          a.path = [];
        }
      }
  }
  // The target leaves the war; armies in each other's land return home.
  const side = sideOf(war, target);
  war.sides[side] = war.sides[side]!.filter((x) => x !== target);
  if (war.sides[0].length === 0 || war.sides[1].length === 0) {
    state.world.wars = state.world.wars.filter((w) => w !== war);
    delete state.diplomacy.wars[war.id];
  }
  for (const a of state.military.armies) {
    if (a.owner !== proposer && a.owner !== target) continue;
    const other = a.owner === proposer ? target : proposer;
    if (owners[a.provinceId] !== other) continue;
    const home = state.world.countries.find((c) => c.id === a.owner)?.capitalProvinceId;
    if (home !== undefined) {
      a.provinceId = home;
      a.path = [];
    }
  }
  state.diplomacy.relations[key(proposer, target)] = clamp(
    baselineRelation(state.world, diplomacyRules(ctx), proposer, target) + rules.peaceRelation,
    -100,
    100,
  );
  emit({ type: 'peace', a: proposer, b: target });
}

/** AI answer to a peace proposal. */
export function aiAcceptsPeace(
  state: GameState,
  ctx: SimContext,
  proposer: string,
  target: string,
  terms: PeaceTerms,
): boolean {
  const c = peaceCost(state, ctx, proposer, target, terms);
  return c !== null && c.cost <= c.available;
}

// ---- Vassals ----

function makeVassal(state: GameState, overlord: string, vassal: string): void {
  // A vassal leaves its other vassal ties.
  state.world.alliances = state.world.alliances.filter(
    (a) => !(a.type === 'vassal' && a.members.includes(vassal)),
  );
  state.world.alliances.push({
    id: `vassal-${overlord}-${vassal}`,
    type: 'vassal',
    members: [overlord, vassal],
  });
}

export const overlordOf = (world: World, id: string): string | undefined =>
  world.alliances.find((a) => a.type === 'vassal' && a.members[1] === id)?.members[0];

export const vassalsOf = (world: World, id: string): string[] =>
  world.alliances
    .filter((a) => a.type === 'vassal' && a.members[0] === id)
    .map((a) => a.members[1]!);

// ---- Actions (commands and AI) ----

const exists = (state: GameState, id: string): boolean =>
  state.world.countries.some(
    (c) => c.id === id && c.provinceIds.length > 0 && c.status !== 'uninhabited',
  );

/** Proposes a defense pact, or asks to join one of the target's alliances (GDD section 10). */
export function proposeAlliance(
  state: GameState,
  ctx: SimContext,
  from: string,
  to: string,
  allianceId?: string,
): ActionResult {
  const rules = diplomacyRules(ctx);
  if (!exists(state, to) || from === to) return { error: 'invalidTarget' };
  if (enemiesAtWar(state.world, from).includes(to)) return { error: 'atWar' };
  const alliance = allianceId ? state.world.alliances.find((a) => a.id === allianceId) : undefined;
  if (allianceId && (!alliance || !alliance.members.includes(to) || alliance.type === 'vassal'))
    return { error: 'invalidTarget' };
  if (alliance?.members.includes(from) || (!alliance && alliesOf(state.world, from).includes(to)))
    return { error: 'alreadyAllied' };
  if (!spend(state, from, rules.costs.alliance)) return { error: 'notEnoughPoints' };
  let accepted: boolean;
  if (alliance) {
    // Every member must be friendly enough and none may be a rival.
    const members = alliance.members;
    const avg = members.reduce((s, m) => s + relation(state, ctx, from, m), 0) / members.length;
    accepted =
      avg >= rules.alliance.joinMinRelation &&
      !members.some(
        (m) =>
          rivalsOf(state.world, from).includes(m) || enemiesAtWar(state.world, from).includes(m),
      );
    if (accepted) alliance.members.push(from);
  } else {
    accepted =
      to !== state.player.countryId &&
      relation(state, ctx, from, to) >= rules.alliance.pactMinRelation &&
      !rivalsOf(state.world, from).includes(to);
    if (accepted)
      state.world.alliances.push({
        id: `pact-${state.turn}-${from}-${to}`,
        type: 'pact',
        members: [from, to],
      });
  }
  return { accepted };
}

export function leaveAlliance(
  state: GameState,
  ctx: SimContext,
  id: string,
  allianceId: string,
): ActionResult {
  const alliance = state.world.alliances.find((a) => a.id === allianceId);
  if (!alliance || !alliance.members.includes(id)) return { error: 'invalidTarget' };
  if (alliance.type === 'vassal' && alliance.members[1] === id) return { error: 'refused' };
  const rules = diplomacyRules(ctx);
  for (const m of alliance.members)
    if (m !== id) changeRelation(state, ctx, id, m, -rules.relations.pact / 2);
  alliance.members = alliance.members.filter((m) => m !== id);
  if (alliance.members.length < 2)
    state.world.alliances = state.world.alliances.filter((a) => a !== alliance);
  return { accepted: true };
}

export function imposeSanctions(
  state: GameState,
  ctx: SimContext,
  from: string,
  to: string,
): ActionResult {
  const rules = diplomacyRules(ctx);
  if (!exists(state, to) || from === to) return { error: 'invalidTarget' };
  if (sanctioned(state, from, to)) return { error: 'sanctioned' };
  if (!spend(state, from, rules.costs.sanction)) return { error: 'notEnoughPoints' };
  addSanctions(state, ctx, from, to);
  return { accepted: true };
}

function addSanctions(state: GameState, ctx: SimContext, from: string, to: string): void {
  const rules = diplomacyRules(ctx).sanctions;
  state.diplomacy.sanctions.push({ from, to, since: state.turn });
  changeRelation(state, ctx, from, to, rules.relation);
  for (const ally of alliesOf(state.world, to))
    changeRelation(state, ctx, from, ally, rules.targetAlliesRelation);
  // Sanctions push the target closer to the sender's rivals.
  for (const rival of rivalsOf(state.world, from))
    if (rival !== to) changeRelation(state, ctx, to, rival, rules.senderRivalsRelation);
}

export function liftSanctions(
  state: GameState,
  ctx: SimContext,
  from: string,
  to: string,
): ActionResult {
  if (!sanctioned(state, from, to)) return { error: 'notSanctioned' };
  state.diplomacy.sanctions = state.diplomacy.sanctions.filter(
    (s) => !(s.from === from && s.to === to),
  );
  changeRelation(state, ctx, from, to, -diplomacyRules(ctx).sanctions.relation / 2);
  return { accepted: true };
}

export function sendUltimatum(
  state: GameState,
  ctx: SimContext,
  from: string,
  to: string,
  demand: Demand,
  threat: Threat,
): ActionResult {
  const rules = diplomacyRules(ctx);
  if (!exists(state, to) || from === to) return { error: 'invalidTarget' };
  if (enemiesAtWar(state.world, from).includes(to)) return { error: 'atWar' };
  if (demand.type === 'province' && state.world.provinceOwners[demand.provinceId] !== to)
    return { error: 'invalidTarget' };
  if (demand.type === 'leaveAlliance') {
    const al = state.world.alliances.find((a) => a.id === demand.allianceId);
    if (!al || !al.members.includes(to)) return { error: 'invalidTarget' };
  }
  if (demand.type === 'liftSanctions' && !sanctioned(state, to, from))
    return { error: 'notSanctioned' };
  if (
    demand.type === 'base' &&
    state.world.provinceOwners[ctx.cityProvince[demand.cityId] ?? -1] !== to
  )
    return { error: 'invalidTarget' };
  if (threat === 'leaveAlliance' && !alliesOf(state.world, from).includes(to))
    return { error: 'invalidTarget' };
  if (!spend(state, from, rules.costs.ultimatum)) return { error: 'notEnoughPoints' };
  const ultimatum: Ultimatum = {
    id: state.diplomacy.nextId++,
    from,
    to,
    demand,
    threat,
    sentTurn: state.turn,
    deadline: state.turn + rules.ultimatum.deadlineTurns,
    status: 'pending',
  };
  state.diplomacy.ultimatums.push(ultimatum);
  if (to === state.player.countryId)
    state.diplomacy.requests.push({
      id: state.diplomacy.nextId++,
      type: 'ultimatum',
      ultimatumId: ultimatum.id,
      until: ultimatum.deadline,
    });
  return { accepted: true };
}

/** How much a country stands to lose by giving in (in threat units). */
function demandValue(state: GameState, ctx: SimContext, u: Ultimatum): number {
  const r = diplomacyRules(ctx).ultimatum.demandCost;
  const d = u.demand;
  switch (d.type) {
    case 'province': {
      const total = populationOf(state, ctx, u.to) || 1;
      return r.province + (ctx.provincePopulation?.[d.provinceId] ?? 0) / total;
    }
    case 'tribute':
      return (r.tribute * d.amountUsd) / Math.max(1, state.economy.countries[u.to]?.gdp ?? 1);
    default:
      return r[d.type];
  }
}

/** AI answer to an ultimatum: how strong and credible the threat is against what it demands. */
export function aiAcceptsUltimatum(state: GameState, ctx: SimContext, u: Ultimatum): boolean {
  const rules = diplomacyRules(ctx);
  const credibility = (state.diplomacy.credibility[u.from] ?? 50) / 100;
  const ratio = sidePower(state, ctx, u.from) / Math.max(1, sidePower(state, ctx, u.to, u.from));
  let threat = rules.ultimatum.threatWeight[u.threat];
  if (u.threat === 'war') threat *= Math.min(3, ratio);
  else if (u.threat === 'sanctions')
    threat *= Math.min(
      3,
      ((state.economy.countries[u.from]?.gdp ?? 0) / worldGdp(state)) *
        rules.ultimatum.sanctionsGdpFactor,
    );
  const resentment = 1 + Math.max(0, -relation(state, ctx, u.from, u.to)) / 100;
  return threat * credibility >= demandValue(state, ctx, u) * resentment;
}

function applyDemand(state: GameState, ctx: SimContext, u: Ultimatum): void {
  const d = u.demand;
  switch (d.type) {
    case 'province':
      if (state.world.provinceOwners[d.provinceId] === u.to)
        transferProvince(state, ctx, d.provinceId, u.from);
      break;
    case 'leaveAlliance':
      leaveAlliance(state, ctx, u.to, d.allianceId);
      break;
    case 'liftSanctions':
      liftSanctions(state, ctx, u.to, u.from);
      break;
    case 'tribute': {
      const from = state.economy.countries[u.to];
      const to = state.economy.countries[u.from];
      if (from && to) {
        const paid = Math.min(from.treasury, d.amountUsd);
        from.treasury -= paid;
        to.treasury += paid;
      }
      break;
    }
    case 'vassal':
      makeVassal(state, u.from, u.to);
      break;
    case 'base':
      addBase(state, u.from, u.to, d.cityId);
      break;
  }
}

/** The receiver answers (player through a request, AI in the diplomacy phase). */
export function answerUltimatum(
  state: GameState,
  ctx: SimContext,
  u: Ultimatum,
  accept: boolean,
  emit: (e: DiplomacyEvent) => void = () => undefined,
): void {
  const rules = diplomacyRules(ctx);
  if (u.status !== 'pending') return;
  if (accept) {
    applyDemand(state, ctx, u);
    u.status = 'accepted';
    changeRelation(state, ctx, u.from, u.to, rules.ultimatum.acceptedRelation);
    adjustCredibility(state, u.from, rules.credibility.enforced);
  } else {
    u.status = 'refused';
    u.enforceBy = state.turn + rules.credibility.enforceTurns;
    changeRelation(state, ctx, u.from, u.to, rules.ultimatum.refusedRelation);
  }
  state.diplomacy.requests = state.diplomacy.requests.filter(
    (r) => !(r.type === 'ultimatum' && r.ultimatumId === u.id),
  );
  emit({ type: 'ultimatumAnswered', ultimatumId: u.id, from: u.from, to: u.to, accepted: accept });
}

function adjustCredibility(state: GameState, id: string, delta: number): void {
  state.diplomacy.credibility[id] = clamp((state.diplomacy.credibility[id] ?? 50) + delta, 0, 100);
}

/** Was the threat of a refused ultimatum carried out? */
function threatCarriedOut(state: GameState, u: Ultimatum): boolean {
  if (u.threat === 'war') return enemiesAtWar(state.world, u.from).includes(u.to);
  if (u.threat === 'sanctions') return sanctioned(state, u.from, u.to);
  return !alliesOf(state.world, u.from).includes(u.to);
}

function addBase(state: GameState, owner: string, host: string, cityId: number): void {
  const bases = (state.world.foreignBases ??= []);
  if (!bases.some((b) => b.owner === owner && b.cityId === cityId))
    bases.push({ owner, host, cityId });
}

/** Price an AI host asks for a base. */
export function basePrice(state: GameState, ctx: SimContext, host: string): number {
  const r = diplomacyRules(ctx).base;
  return Math.max(r.minPriceUsd, (state.economy.countries[host]?.gdp ?? 0) * r.priceShareOfHostGdp);
}

/** Asks for a base, or pays for one (GDD section 10: the host can refuse). */
export function requestBase(
  state: GameState,
  ctx: SimContext,
  owner: string,
  cityId: number,
  pay: boolean,
): ActionResult {
  const rules = diplomacyRules(ctx);
  const host = state.world.provinceOwners[ctx.cityProvince[cityId] ?? -1];
  if (!host || host === owner || !exists(state, host)) return { error: 'invalidTarget' };
  if (enemiesAtWar(state.world, owner).includes(host)) return { error: 'atWar' };
  if (sanctionsBetween(state, owner, host)) return { error: 'sanctioned' };
  const price = pay ? basePrice(state, ctx, host) : 0;
  if (pay && (state.economy.countries[owner]?.treasury ?? 0) < price)
    return { error: 'notEnoughMoney' };
  if (!spend(state, owner, rules.costs.base)) return { error: 'notEnoughPoints' };
  const r = relation(state, ctx, owner, host);
  const accepted =
    host !== state.player.countryId &&
    !rivalsOf(state.world, owner).includes(host) &&
    r >= (pay ? rules.base.payMinRelation : rules.base.askMinRelation);
  if (accepted) {
    if (pay) {
      state.economy.countries[owner]!.treasury -= price;
      state.economy.countries[host]!.treasury += price;
    }
    addBase(state, owner, host, cityId);
  }
  return { accepted };
}

/** Sends money and/or weapons (GDD section 10: the receiver's enemies resent it). */
export function sendAid(
  state: GameState,
  ctx: SimContext,
  from: string,
  to: string,
  money: number,
  weapons?: { weapon: WeaponKind; tier: number; count: number },
): ActionResult {
  const rules = diplomacyRules(ctx);
  if (!exists(state, to) || from === to) return { error: 'invalidTarget' };
  if (enemiesAtWar(state.world, from).includes(to)) return { error: 'atWar' };
  const e = state.economy.countries[from]!;
  const amount = Math.max(0, money);
  if (amount > e.treasury) return { error: 'notEnoughMoney' };
  let value = amount;
  const giver = state.weapons?.countries[from];
  const receiver = state.weapons?.countries[to];
  if (weapons && weapons.count > 0) {
    const stock = weapons.weapon === 'missile' ? giver?.missiles : giver?.drones;
    if (!stock || !receiver || (stock[weapons.tier - 1] ?? 0) < weapons.count)
      return { error: 'noStock' };
    const tiers =
      weapons.weapon === 'missile' ? weaponsRules(ctx).missiles : weaponsRules(ctx).drones;
    value += (tiers[weapons.tier - 1]?.costUsd ?? 0) * weapons.count;
  }
  if (value <= 0) return { error: 'invalidTarget' };
  if (!spend(state, from, rules.costs.aid)) return { error: 'notEnoughPoints' };
  e.treasury -= amount;
  state.economy.countries[to]!.treasury += amount;
  if (weapons && weapons.count > 0) {
    const stock = weapons.weapon === 'missile' ? giver!.missiles : giver!.drones;
    const into = weapons.weapon === 'missile' ? receiver!.missiles : receiver!.drones;
    stock[weapons.tier - 1]! -= weapons.count;
    into[weapons.tier - 1] = (into[weapons.tier - 1] ?? 0) + weapons.count;
  }
  const gdp = Math.max(1, state.economy.countries[to]?.gdp ?? 1);
  changeRelation(
    state,
    ctx,
    from,
    to,
    Math.min(rules.aid.maxRelation, (value / gdp) * rules.aid.relationPerGdpShare),
  );
  for (const enemy of enemiesAtWar(state.world, to))
    changeRelation(state, ctx, from, enemy, rules.aid.enemyRelation);
  return { accepted: true };
}

/** Price of weapons in a trade. */
export function weaponPrice(
  ctx: SimContext,
  weapon: WeaponKind,
  tier: number,
  count: number,
): number {
  const tiers = weapon === 'missile' ? weaponsRules(ctx).missiles : weaponsRules(ctx).drones;
  return (tiers[tier - 1]?.costUsd ?? 0) * count * diplomacyRules(ctx).trade.markup;
}

/** How many weapons an AI seller is willing to sell. */
export function forSale(
  state: GameState,
  ctx: SimContext,
  seller: string,
  buyer: string,
  weapon: WeaponKind,
  tier: number,
): number {
  const rules = diplomacyRules(ctx).trade;
  const a = state.weapons?.countries[seller];
  if (!a || sanctionsBetween(state, seller, buyer)) return 0;
  if (relation(state, ctx, seller, buyer) < rules.minRelation) return 0;
  // No weapons for the enemies of its friends.
  const friends = [seller, ...alliesOf(state.world, seller)];
  if (enemiesAtWar(state.world, buyer).some((e) => friends.includes(e))) return 0;
  const stock = weapon === 'missile' ? a.missiles : a.drones;
  return Math.floor((stock[tier - 1] ?? 0) * rules.sellShare);
}

/** Weapons trade (GDD section 10, blocked by sanctions). The buyer pays the seller. */
export function tradeWeapons(
  state: GameState,
  ctx: SimContext,
  buyer: string,
  seller: string,
  weapon: WeaponKind,
  tier: number,
  count: number,
): ActionResult {
  const rules = diplomacyRules(ctx).trade;
  const player = state.player.countryId;
  if (!exists(state, buyer) || !exists(state, seller) || buyer === seller)
    return { error: 'invalidTarget' };
  if (sanctionsBetween(state, buyer, seller)) return { error: 'sanctioned' };
  if (enemiesAtWar(state.world, buyer).includes(seller)) return { error: 'atWar' };
  const n = Math.floor(count);
  const price = weaponPrice(ctx, weapon, tier, n);
  const pay = state.economy.countries[buyer]!;
  const sellerArsenal = state.weapons.countries[seller];
  const stock = weapon === 'missile' ? sellerArsenal?.missiles : sellerArsenal?.drones;
  if (n < 1 || !stock || (stock[tier - 1] ?? 0) < n) return { error: 'noStock' };
  if (pay.treasury < price) return { error: 'notEnoughMoney' };
  let accepted = true;
  if (seller !== player && n > forSale(state, ctx, seller, buyer, weapon, tier)) accepted = false;
  if (buyer !== player) {
    // An AI buyer wants weapons when at war or among friends, and keeps money for itself.
    const wants =
      enemiesAtWar(state.world, buyer).length > 0 ||
      relation(state, ctx, buyer, seller) >= rules.buyMinRelation;
    if (!wants || pay.treasury < price * 2) accepted = false;
  }
  if (!accepted) return { accepted: false };
  pay.treasury -= price;
  state.economy.countries[seller]!.treasury += price;
  stock[tier - 1]! -= n;
  const into =
    weapon === 'missile'
      ? state.weapons.countries[buyer]!.missiles
      : state.weapons.countries[buyer]!.drones;
  into[tier - 1] = (into[tier - 1] ?? 0) + n;
  changeRelation(state, ctx, buyer, seller, 3);
  return { accepted: true };
}

/** Vassals (GDD section 10): ask a country, offer yourself, transfer or release a vassal. */
export function vassalAction(
  state: GameState,
  ctx: SimContext,
  from: string,
  mode: 'ask' | 'offer' | 'transfer' | 'release',
  to: string,
  vassal?: string,
): ActionResult {
  const rules = diplomacyRules(ctx);
  if (mode === 'release') {
    if (overlordOf(state.world, to) !== from) return { error: 'invalidTarget' };
    state.world.alliances = state.world.alliances.filter(
      (a) => !(a.type === 'vassal' && a.members[0] === from && a.members[1] === to),
    );
    changeRelation(state, ctx, from, to, 10);
    return { accepted: true };
  }
  if (!exists(state, to) || from === to) return { error: 'invalidTarget' };
  if (enemiesAtWar(state.world, from).includes(to)) return { error: 'atWar' };
  if (mode === 'transfer' && (!vassal || overlordOf(state.world, vassal) !== from || vassal === to))
    return { error: 'invalidTarget' };
  if (!spend(state, from, rules.costs.vassal)) return { error: 'notEnoughPoints' };
  const r = relation(state, ctx, from, to);
  const player = state.player.countryId;
  let accepted: boolean;
  if (mode === 'ask') {
    const ratio = sidePower(state, ctx, from) / Math.max(1, sidePower(state, ctx, to, from));
    accepted =
      to !== player &&
      !overlordOf(state.world, to) &&
      ratio >= rules.vassal.askPowerRatio &&
      r >= rules.vassal.askMinRelation;
    if (accepted) makeVassal(state, from, to);
  } else if (mode === 'offer') {
    accepted = to !== player && r >= rules.vassal.offerMinRelation;
    if (accepted) makeVassal(state, to, from);
  } else {
    accepted = to !== player && r >= rules.vassal.transferMinRelation;
    if (accepted) makeVassal(state, to, vassal!);
  }
  return { accepted };
}

/** Peace proposal (GDD section 8: demands capped by the war score). */
export function proposePeace(
  state: GameState,
  ctx: SimContext,
  proposer: string,
  target: string,
  terms: PeaceTerms,
): ActionResult {
  if (!warBetween(state.world, proposer, target)) return { error: 'notAtWar' };
  if (target === state.player.countryId) {
    const war = warBetween(state.world, proposer, target)!;
    state.diplomacy.requests.push({
      id: state.diplomacy.nextId++,
      type: 'peace',
      from: proposer,
      warId: war.id,
      terms,
      until: state.turn + diplomacyRules(ctx).war.requestTurns,
    });
    return { accepted: true };
  }
  const war = warBetween(state.world, proposer, target)!;
  const started = state.diplomacy.wars[war.id]?.startTurn ?? -Infinity;
  if (state.turn - started < diplomacyRules(ctx).peace.minTurns) return { error: 'tooEarly' };
  const accepted = aiAcceptsPeace(state, ctx, proposer, target, terms);
  if (accepted) applyPeace(state, ctx, proposer, target, terms);
  return { accepted };
}

/** The player answers a request (join a war, a peace offer, an ultimatum). */
export function answerRequest(
  state: GameState,
  ctx: SimContext,
  requestId: number,
  accept: boolean,
  emit: (e: DiplomacyEvent) => void = () => undefined,
): ActionResult {
  const rules = diplomacyRules(ctx);
  const request = state.diplomacy.requests.find((r) => r.id === requestId);
  if (!request) return { error: 'unknownRequest' };
  const player = state.player.countryId;
  state.diplomacy.requests = state.diplomacy.requests.filter((r) => r !== request);
  if (request.type === 'joinWar') {
    const war = state.world.wars.find((w) => w.id === request.warId);
    if (!war) return { accepted: false };
    if (accept) {
      addToWar(state, war, sideOf(war, request.from), player);
      changeRelation(state, ctx, player, request.from, 10);
      changeRelation(state, ctx, player, request.enemy, rules.war.declaredRelation);
    } else {
      changeRelation(state, ctx, player, request.from, rules.war.refusedJoinRelation);
    }
  } else if (request.type === 'investment') {
    // A foreign country builds in our city at its own cost (GDD section 6).
    if (accept) investAbroad(state, ctx, request.from, request.cityId, request.category);
  } else if (request.type === 'peace') {
    if (accept && warBetween(state.world, request.from, player))
      applyPeace(state, ctx, request.from, player, request.terms, emit);
  } else {
    const u = state.diplomacy.ultimatums.find((x) => x.id === request.ultimatumId);
    if (u) answerUltimatum(state, ctx, u, accept, emit);
  }
  return { accepted: accept };
}

// ---- Turn step 8 ----

/** Turn step 8 (GDD section 5): points, war score, ultimatums, peace, tribute, sanctions. */
export function diplomacyPhase(
  state: GameState,
  ctx: SimContext,
  events: readonly TurnEvent[],
  emit: (e: DiplomacyEvent) => void,
): void {
  const rules = diplomacyRules(ctx);
  const d = state.diplomacy;
  const player = state.player.countryId;

  // Diplomatic points.
  for (const c of state.world.countries) {
    if (c.provinceIds.length === 0) continue;
    d.credibility[c.id] ??= rules.credibility.start;
    const income = pointsIncome(state, ctx, c.id);
    d.points[c.id] = Math.min(income * rules.points.capTurns, (d.points[c.id] ?? 0) + income);
  }

  // War score from this turn's battles, captures and strikes.
  for (const w of state.world.wars) d.wars[w.id] ??= warRecord(state, ctx, w);
  const credit = (winner: string, loser: string, points: number): void => {
    const war = warBetween(state.world, winner, loser);
    const record = war && d.wars[war.id];
    if (war && record) record.gain[sideOf(war, winner)]! += points;
  };
  for (const e of events) {
    if (e.type === 'battle') {
      const winner = e.winner === 'attacker' ? e.attacker : e.defender;
      credit(winner, winner === e.attacker ? e.defender : e.attacker, rules.peace.battlePoints);
    } else if (e.type === 'provinceCaptured') {
      const war = warBetween(state.world, e.to, e.from);
      credit(
        e.to,
        e.from,
        provinceValue(state, ctx, war ? d.wars[war.id] : undefined, e.provinceId),
      );
    } else if (e.type === 'strike') {
      credit(e.attacker, e.defender, (e.soldiersKilled / 1e4) * rules.peace.strikePointsPer10k);
    } else if (e.type === 'nuclearStrike') {
      // Global sanctions and the collapse of relations (GDD section 9).
      const allies = new Set(alliesOf(state.world, e.attacker));
      for (const c of state.world.countries) {
        if (c.id === e.attacker || c.provinceIds.length === 0) continue;
        changeRelation(
          state,
          ctx,
          c.id,
          e.attacker,
          allies.has(c.id) ? rules.nuclear.alliesRelation : rules.nuclear.relation,
        );
        if (!allies.has(c.id) && !sanctioned(state, c.id, e.attacker))
          d.sanctions.push({ from: c.id, to: e.attacker, since: state.turn });
      }
      emit({ type: 'globalSanctions', countryId: e.attacker });
    }
  }

  // Relations drift slowly back toward what alliances, rivalries and wars imply.
  for (const [k, v] of Object.entries(d.relations)) {
    const [a, b] = k.split('|') as [string, string];
    const base = baselineRelation(state.world, rules, a, b);
    if (enemiesAtWar(state.world, a).includes(b)) {
      d.relations[k] = Math.min(v, base + 50);
      continue;
    }
    const next =
      v + Math.sign(base - v) * Math.min(Math.abs(base - v), rules.relations.driftPerTurn);
    if (
      Math.abs(next - base) < 0.5 &&
      !(ctx.relationOverrides ?? []).some((o) => key(o.a, o.b) === k)
    )
      delete d.relations[k];
    else d.relations[k] = next;
  }

  // Ultimatums: AI receivers answer, deadlines pass, threats are carried out or credibility falls.
  for (const u of d.ultimatums) {
    if (u.status === 'pending') {
      if (u.to !== player && state.turn > u.sentTurn)
        answerUltimatum(state, ctx, u, aiAcceptsUltimatum(state, ctx, u), emit);
      else if (state.turn >= u.deadline) answerUltimatum(state, ctx, u, false, emit);
    } else if (u.status === 'refused') {
      if (threatCarriedOut(state, u)) {
        u.status = 'enforced';
        adjustCredibility(state, u.from, rules.credibility.enforced);
      } else if (state.turn >= (u.enforceBy ?? state.turn)) {
        u.status = 'failed';
        adjustCredibility(state, u.from, -rules.credibility.failed);
        emit({ type: 'credibilityLost', countryId: u.from });
      }
    }
  }
  d.ultimatums = d.ultimatums.filter(
    (u) => u.status === 'pending' || u.status === 'refused' || state.turn - u.sentTurn < 12,
  );

  // Requests to the player expire.
  for (const r of [...d.requests]) {
    if (state.turn < r.until) continue;
    if (r.type === 'ultimatum') continue;
    answerRequest(state, ctx, r.id, false, emit);
  }

  // Vassals pay tribute.
  for (const al of state.world.alliances) {
    if (al.type !== 'vassal') continue;
    const [overlord, vassal] = al.members as [string, string];
    const ev = state.economy.countries[vassal];
    const eo = state.economy.countries[overlord];
    if (!ev || !eo) continue;
    const tribute = Math.min(ev.treasury, ((ev.gdp * ev.taxRate) / 52) * rules.vassal.tributeShare);
    ev.treasury -= tribute;
    eo.treasury += tribute;
  }

  // Bases abroad close when relations break down.
  if (state.world.foreignBases) {
    state.world.foreignBases = state.world.foreignBases.filter(
      (b) =>
        state.world.provinceOwners[ctx.cityProvince[b.cityId] ?? -1] === b.host &&
        !enemiesAtWar(state.world, b.owner).includes(b.host) &&
        !sanctionsBetween(state, b.owner, b.host) &&
        relation(state, ctx, b.owner, b.host) >= rules.base.removeBelowRelation,
    );
  }
  d.demilitarized = d.demilitarized.filter((x) => x.until > state.turn);

  // Peace between AI countries, and AI peace offers to the player.
  for (const war of [...state.world.wars]) {
    const record = d.wars[war.id];
    if (!record || war.id.startsWith('revolution-')) continue;
    const turns = state.turn - record.startTurn;
    if (turns < rules.peace.aiPeaceMinTurns) continue;
    const a = war.sides[0][0];
    const b = war.sides[1][0];
    if (!a || !b) continue;
    const score = warScore(state, war.id, a);
    const [winner, loser] = score >= 0 ? [a, b] : [b, a];
    const decisive = Math.abs(score) >= rules.peace.aiPeaceScore;
    const stalemate = turns >= rules.peace.aiStalemateTurns;
    if (!decisive && !stalemate) continue;
    if (winner === player || loser === player) {
      if (state.turn - record.lastOffer < rules.peace.aiOfferEvery) continue;
      if (d.requests.some((r) => r.type === 'peace' && r.warId === war.id)) continue;
      record.lastOffer = state.turn;
      const proposer = winner === player ? loser : winner;
      // The AI offers to end the war with each side keeping what it holds.
      proposePeace(state, ctx, proposer, player, WHITE_PEACE);
      const request = d.requests.at(-1);
      if (request) emit({ type: 'request', requestId: request.id });
    } else {
      // The whole losing side makes peace with the winner.
      const terms: PeaceTerms = { ...WHITE_PEACE, reparationsShare: decisive ? 0.05 : 0 };
      const losers = [...war.sides[sideOf(war, loser)]!];
      for (const l of losers)
        if (l !== player && warBetween(state.world, winner, l))
          applyPeace(state, ctx, winner, l, terms, emit);
    }
  }
}

/** Provinces where a country may not station armies after a peace treaty. */
export function demilitarizedFor(state: GameState, id: string): Set<number> {
  return new Set(
    (state.diplomacy?.demilitarized ?? [])
      .filter((x) => x.country === id)
      .flatMap((x) => x.provinceIds),
  );
}

/** Main city of a province, for base requests from the UI. */
export const baseCityOf = (ctx: SimContext, provinceId: number): number =>
  provinceSeat(ctx, provinceId);

/** An investment by one country in another's city, paid by the investor. */
export function investAbroad(
  state: GameState,
  ctx: SimContext,
  investor: string,
  cityId: number,
  categoryId: string,
): boolean {
  const cat = ctx.economy.investment.categories.find((c) => c.id === categoryId);
  const host = state.world.provinceOwners[ctx.cityProvince[cityId] ?? -1];
  const e = state.economy.countries[investor];
  if (!cat || !host || !e || e.treasury < cat.costUsd) return false;
  e.treasury -= cat.costUsd;
  state.economy.buildings.push({
    id: state.economy.nextBuildingId++,
    category: cat.id,
    cityId,
    owner: investor,
    host,
    costUsd: cat.costUsd,
    startedTurn: state.turn,
    completeTurn: state.turn + cat.buildTurns,
    completed: false,
  });
  return true;
}

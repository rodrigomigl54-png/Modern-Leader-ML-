// AI offers to the player (Dario, idea 5): now and then another country comes to the player with
// a deal of its own, built from the trade-deal parts (deals.ts): a neighbor offers a
// non-aggression pact, a country at war pays for military access, a friend asks for financial
// aid, or a friend pays the player to join sanctions against a common rival. The player accepts
// or refuses in a corner notification; an unanswered offer expires as a refusal.
// Rules are in data/modern/diplomacy-rules.json ("offers"). The draws use their own random
// stream, so offers never shift any other random result.
import { type Deal, dealError, nonAggressionBetween } from './deals';
import {
  diplomacyRules,
  hasAccess,
  relation,
  sanctioned,
  type DiplomacyEvent,
  type PlayerRequest,
} from './diplomacy';
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { neighborsOf } from './randomEvents';
import { createRng } from './rng';
import { alliesOf, enemiesAtWar, rivalsOf } from './world';

export type OfferKind = 'nonAggression' | 'buyAccess' | 'aid' | 'coalition';

export interface OfferRules {
  /** Chance per week that some country makes the player an offer. */
  chancePerWeek: number;
  /** Weeks between two offers. */
  minGapWeeks: number;
  /** Weeks before the same country makes the same kind of offer again. */
  repeatGapWeeks: number;
  answerTurns: number;
  /** Relation change when the player refuses (or lets the offer expire). */
  refusedRelation: number;
  /** Money offered (for access or a coalition), as a share of the payer's GDP. */
  payGdpShare: number;
  /** Aid asked for, as a share of the player's GDP, at most aidTreasuryShare of the treasury. */
  aidGdpShare: number;
  aidTreasuryShare: number;
  /** A payer spends at most this share of its treasury. */
  payTreasuryShare: number;
  /** Relation ranges for each kind. */
  nonAggressionRelation: [number, number];
  accessMinRelation: number;
  aidMinRelation: number;
  coalitionMinRelation: number;
}

export interface OffersState {
  rng: number;
  /** Turn of the last offer. */
  last: number;
  /** Last turn of each "kind|country" offer. */
  seen: Record<string, number>;
}

export function emptyOffers(seed: number): OffersState {
  return { rng: (seed ^ 0x2f6b8d13) >>> 0, last: -Infinity, seen: {} };
}

export function offerRules(ctx: SimContext): OfferRules | undefined {
  return diplomacyRules(ctx).offers;
}

interface Candidate {
  kind: OfferKind;
  from: string;
  deal: Deal;
}

/** Every offer that could be made to the player this week, in a fixed order. */
export function offerCandidates(state: GameState, ctx: SimContext): Candidate[] {
  const r = offerRules(ctx);
  if (!r) return [];
  const player = state.player.countryId;
  const live = state.world.countries.filter(
    (c) => c.id !== player && c.status === 'full' && c.provinceIds.length > 0,
  );
  const me = state.economy.countries[player];
  if (!me) return [];
  const myAllies = new Set(alliesOf(state.world, player));
  const myEnemies = new Set(enemiesAtWar(state.world, player));
  const neighbors = new Set(neighborsOf(state, ctx, player));
  const treasury = (id: string): number => Math.max(0, state.economy.countries[id]?.treasury ?? 0);
  const payment = (payer: string): number =>
    Math.round(
      Math.min(
        (state.economy.countries[payer]?.gdp ?? 0) * r.payGdpShare,
        treasury(payer) * r.payTreasuryShare,
      ),
    );
  const out: Candidate[] = [];
  for (const c of live) {
    const id = c.id;
    if (myEnemies.has(id)) continue;
    const rel = relation(state, ctx, id, player);
    // A wary neighbor wants calm on the border.
    if (
      neighbors.has(id) &&
      !myAllies.has(id) &&
      !nonAggressionBetween(state, id, player) &&
      rel >= r.nonAggressionRelation[0] &&
      rel <= r.nonAggressionRelation[1]
    )
      out.push({
        kind: 'nonAggression',
        from: id,
        deal: { give: {}, take: {}, nonAggression: true },
      });
    // A country at war pays to march through our land to its enemy.
    const theirEnemies = enemiesAtWar(state.world, id);
    if (
      theirEnemies.length > 0 &&
      rel >= r.accessMinRelation &&
      !hasAccess(state, id, player) &&
      !theirEnemies.some((e) => myAllies.has(e)) &&
      theirEnemies.some((e) => neighbors.has(e))
    ) {
      const money = payment(id);
      if (money > 0)
        out.push({
          kind: 'buyAccess',
          from: id,
          deal: { give: { money }, take: { militaryAccess: true } },
        });
    }
    // A poorer friend asks for help.
    if (rel >= r.aidMinRelation && (state.economy.countries[id]?.gdp ?? 0) < me.gdp) {
      const money = Math.round(
        Math.min(me.gdp * r.aidGdpShare, treasury(player) * r.aidTreasuryShare),
      );
      if (money > 0) out.push({ kind: 'aid', from: id, deal: { give: {}, take: { money } } });
    }
    // A friend pays us to sanction a rival we both dislike.
    if (rel >= r.coalitionMinRelation) {
      const rival = rivalsOf(state.world, id)
        .filter(
          (x) =>
            x !== player &&
            !myAllies.has(x) &&
            !sanctioned(state, player, x) &&
            relation(state, ctx, player, x) < 0 &&
            live.some((l) => l.id === x),
        )
        .sort()[0];
      const money = payment(id);
      if (rival && money > 0)
        out.push({
          kind: 'coalition',
          from: id,
          deal: { give: { money }, take: { sanctionsOn: rival } },
        });
    }
  }
  return out.filter((o) => !dealError(state, o.from, player, o.deal));
}

/** Turn step 9: maybe one AI country makes the player an offer. */
export function offersPhase(
  state: GameState,
  ctx: SimContext,
  emit: (e: DiplomacyEvent) => void,
): void {
  const r = offerRules(ctx);
  if (!r || !ctx.diplomacy) return;
  const o = (state.offers ??= emptyOffers(state.rngState));
  const rng = createRng(o.rng);
  // One draw every week, so the stream never depends on what else happened.
  const roll = rng.next();
  const pick = rng.next();
  o.rng = rng.state;
  const d = state.diplomacy;
  if (roll >= r.chancePerWeek || state.turn - o.last < r.minGapWeeks) return;
  if (d.requests.some((x) => x.type === 'deal')) return;
  const candidates = offerCandidates(state, ctx).filter(
    (c) => state.turn - (o.seen[`${c.kind}|${c.from}`] ?? -Infinity) >= r.repeatGapWeeks,
  );
  const chosen = candidates[Math.floor(pick * candidates.length)];
  if (!chosen) return;
  o.last = state.turn;
  o.seen[`${chosen.kind}|${chosen.from}`] = state.turn;
  const request: PlayerRequest = {
    id: d.nextId++,
    type: 'deal',
    kind: chosen.kind,
    from: chosen.from,
    deal: chosen.deal,
    until: state.turn + r.answerTurns,
  };
  d.requests.push(request);
  emit({ type: 'request', requestId: request.id });
}

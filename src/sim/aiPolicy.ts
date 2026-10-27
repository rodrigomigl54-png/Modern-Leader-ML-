// AI foreign and economic policy from behavior profiles (GDD section 11), turn step 1. Every AI
// country manages its budget and investments, and, by its traits, sanctions, pressures weaker
// states with ultimatums, carries out its threats, starts wars, intervenes for its partners,
// sends aid and proposes pacts. The aggressiveness setting scales the hostile traits. The AI
// never acts outside its profile; all randomness is seeded.
import {
  imposeSanctions,
  improveRelations,
  insult,
  insultedBetween,
  investAbroad,
  leaveAlliance,
  missionsOf,
  proposeAlliance,
  requestAccess,
  relation,
  sanctioned,
  sendAid,
  sendUltimatum,
  startWar,
  power,
  warScore,
  warBetween,
  type DiplomacyEvent,
} from './diplomacy';
import { investmentQuote, weeklyBudget, type SimContext } from './economy';
import { citiesOfProvince, entryRule } from './military';
import type { GoalKind } from './goals';
import type { GameState } from './newGame';
import { nationalSupport } from './population';
import { trait, type AiRules } from './profiles';
import type { Rng } from './rng';
import { alliesOf, enemiesAtWar, type WorldCountry } from './world';

export type AiPolicyEvent =
  | { type: 'warDeclared'; attacker: string; target: string }
  | { type: 'sanctionsImposed'; from: string; to: string }
  | { type: 'nuclearThreat'; from: string; to: string };

const INVEST_CATEGORIES = ['factory', 'agriculture', 'infrastructure', 'energy', 'university'];

function rules(ctx: SimContext): AiRules {
  if (!ctx.aiRules) throw new Error('AI rules missing from the simulation context');
  return ctx.aiRules;
}

/** Chance per turn of an action, scaled by a trait (and jittered in Chaos). */
function chance(state: GameState, ctx: SimContext, rng: Rng, value: number, rate: number): boolean {
  const r = rules(ctx);
  const jitter = state.settings.aggressiveness === 'chaos' ? rng.next() * r.chaosTimingJitter : 1;
  return rng.next() < (value / 100) * rate * jitter;
}

function neighborsOf(state: GameState, ctx: SimContext, country: WorldCountry): string[] {
  const land = ctx.provinceNeighbors ?? [];
  const owners = state.world.provinceOwners;
  const result = new Set<string>();
  for (const p of country.provinceIds)
    for (const q of land[p] ?? []) if (owners[q] !== country.id) result.add(owners[q]!);
  return [...result].sort();
}

export function aiPolicyOrders(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  emit: (e: AiPolicyEvent | DiplomacyEvent) => void,
): void {
  if (!ctx.aiRules || !state.diplomacy) return;
  const r = rules(ctx);
  const t = r.thresholds;
  const player = state.player.countryId;
  const countries = state.world.countries.filter(
    (c) =>
      c.id !== player &&
      c.provinceIds.length > 0 &&
      c.status !== 'uninhabited' &&
      c.status !== 'rebels',
  );
  const live = new Set(
    state.world.countries.filter((c) => c.provinceIds.length > 0).map((c) => c.id),
  );
  // Military strength per country, computed once per turn.
  const strength = new Map<string, number>();
  const strengthOf = (x: string): number => {
    let v = strength.get(x);
    if (v === undefined) {
      v = power(state, ctx, x);
      strength.set(x, v);
    }
    return v;
  };
  const sidePower = (x: string): number =>
    strengthOf(x) + 0.5 * alliesOf(state.world, x).reduce((s, a) => s + strengthOf(a), 0);
  const nuclearPower = (x: string): boolean => (state.weapons?.countries[x]?.warheads ?? 0) > 0;
  // War aid is counted afresh every week.
  for (const e of Object.values(state.economy.countries)) if (e.aid) e.aid = 0;

  for (const country of countries) {
    const id = country.id;
    const e = state.economy.countries[id];
    if (!e) continue;
    const T = (x: Parameters<typeof trait>[3]): number => trait(state, ctx, id, x);
    const profile = ctx.profiles?.[id];
    // The country's own goals steer its choices (GDD section 13).
    const goals = state.aiGoals?.[id] ?? [];
    const pursues = (kind: GoalKind): boolean =>
      goals.some((g) => g.kind === kind && g.status === 'active');
    const g = r.goals;

    // Budget: every few weeks, close deficits or calm the people.
    if ((state.turn + id.charCodeAt(0)) % r.fiscal.everyTurns === 0) {
      const b = weeklyBudget(state, id, ctx);
      const support = nationalSupport(state, ctx, id);
      const debtLimit = r.fiscal.debtLimit * (g && pursues('lowDebt') ? g.debtLimitFactor : 1);
      const riots = ctx.population?.riots.threshold ?? 0;
      const f = r.fiscal;
      if (
        f.crisisMargin !== undefined &&
        support < riots + f.crisisMargin &&
        e.servicesShare < f.targetServices &&
        e.debt / Math.max(1, e.gdp) < f.crisisDebtLimit!
      ) {
        // Riots are near: services first, even on borrowed money (cutting them would feed the
        // unrest that ends governments).
        e.servicesShare += f.step;
      } else if (b.balance < 0 && e.debt / Math.max(1, e.gdp) > debtLimit) {
        if (e.taxRate < r.fiscal.maxTax && support > r.fiscal.lowSupport)
          e.taxRate += r.fiscal.step;
        else if (e.servicesShare > r.fiscal.minServices) e.servicesShare -= r.fiscal.step;
      } else if (
        support < r.fiscal.lowSupport &&
        (b.balance > 0 || e.treasury > b.spending * r.fiscal.reserveWeeks)
      ) {
        // An angry people with money in the bank: better services first, then lower taxes.
        if (e.servicesShare < r.fiscal.targetServices) e.servicesShare += r.fiscal.step;
        else if (e.taxRate > r.fiscal.minTax) e.taxRate -= r.fiscal.step;
      }
      // Money beyond a few weeks of spending pays back debt.
      const spare = e.treasury - b.spending * r.fiscal.repayAboveWeeks;
      if (spare > 0 && e.debt > 0) {
        const repaid = Math.min(e.debt, spare);
        e.debt -= repaid;
        e.treasury -= repaid;
      }
    }

    // Investment at home, and occasionally in the player's cities (the player decides).
    const economy = T('economy');
    const investRate = r.rates.invest * (g && pursues('gdpGrowth') ? g.investFactor : 1);
    if (chance(state, ctx, rng, economy, investRate)) {
      const category = INVEST_CATEGORIES[(state.turn + id.length) % INVEST_CATEGORIES.length]!;
      const cities = country.provinceIds.flatMap((p) => citiesOfProvince(ctx, p).slice(0, 1));
      const city = cities[Math.floor(rng.next() * cities.length)];
      const quote = city !== undefined ? investmentQuote(state, ctx, id, [city], category) : null;
      const spending = weeklyBudget(state, id, ctx).spending;
      if (city !== undefined && quote?.affordable && e.treasury - quote.totalCost > spending * 8)
        investAbroad(state, ctx, id, city, category);
    }
    if (
      live.has(player) &&
      !state.economy.countries[player]?.rejectForeignInvestment &&
      relation(state, ctx, id, player) >= t.investInPlayerRelation &&
      chance(state, ctx, rng, economy, r.rates.investInPlayer)
    ) {
      const target = state.world.countries.find((c) => c.id === player)!;
      const cities = target.provinceIds.flatMap((p) => citiesOfProvince(ctx, p).slice(0, 1));
      const city = cities[Math.floor(rng.next() * cities.length)];
      const category = INVEST_CATEGORIES[Math.floor(rng.next() * 3)]!;
      const cost =
        ctx.economy.investment.categories.find((c) => c.id === category)?.costUsd ?? Infinity;
      if (
        city !== undefined &&
        e.treasury > cost * 4 &&
        !state.diplomacy.requests.some((q) => q.type === 'investment')
      ) {
        const request = {
          id: state.diplomacy.nextId++,
          type: 'investment' as const,
          from: id,
          cityId: city,
          category,
          until: state.turn + 3,
        };
        state.diplomacy.requests.push(request);
        emit({ type: 'request', requestId: request.id });
      }
    }

    const partners = new Set(profile?.partners ?? []);
    const rivals = new Set([
      ...(profile?.rivals ?? []),
      ...state.world.rivalries.flatMap((x) => (x.a === id ? [x.b] : x.b === id ? [x.a] : [])),
    ]);
    const myPower = sidePower(id);

    // Sanctions on rivals and hostile countries.
    for (const other of [...rivals].filter((x) => live.has(x)).sort()) {
      if (sanctioned(state, id, other) || relation(state, ctx, id, other) > t.sanctionRelation)
        continue;
      if (!chance(state, ctx, rng, T('sanctions'), r.rates.sanction)) continue;
      const result = imposeSanctions(state, ctx, id, other);
      if ('accepted' in result) emit({ type: 'sanctionsImposed', from: id, to: other });
      break;
    }

    // Pressure on weaker states: ultimatums to hostile, much weaker neighbors and rivals.
    if (
      !state.diplomacy.ultimatums.some(
        (u) => u.from === id && (u.status === 'pending' || u.status === 'refused'),
      )
    ) {
      const candidates = [...new Set([...neighborsOf(state, ctx, country), ...rivals])].filter(
        (x) =>
          live.has(x) &&
          !enemiesAtWar(state.world, id).includes(x) &&
          !alliesOf(state.world, id).includes(x) &&
          relation(state, ctx, id, x) <= t.ultimatumRelation &&
          myPower >= sidePower(x) * t.ultimatumPower,
      );
      const target = candidates.sort()[0];
      if (target && chance(state, ctx, rng, T('pressure'), r.rates.ultimatum)) {
        const targetCountry = state.world.countries.find((c) => c.id === target)!;
        const land = ctx.provinceNeighbors ?? [];
        const border = targetCountry.provinceIds.find((p) =>
          land[p]?.some((q) => state.world.provinceOwners[q] === id),
        );
        const demand = sanctioned(state, target, id)
          ? ({ type: 'liftSanctions' } as const)
          : T('expansionism') >= 50 && border !== undefined
            ? ({ type: 'province', provinceId: border } as const)
            : ({
                type: 'tribute',
                amountUsd: (state.economy.countries[target]?.gdp ?? 0) * 0.01,
              } as const);
        const threat = T('risk') >= t.enforceRisk ? 'war' : 'sanctions';
        const result = sendUltimatum(state, ctx, id, target, demand, threat);
        if ('accepted' in result && target === player) {
          const request = state.diplomacy.requests.at(-1);
          if (request) emit({ type: 'request', requestId: request.id });
        }
      }
    }

    // Carry out threats of refused ultimatums (otherwise credibility is lost in step 8).
    for (const u of state.diplomacy.ultimatums) {
      if (u.from !== id || u.status !== 'refused' || !live.has(u.to)) continue;
      if (u.threat === 'war' && !enemiesAtWar(state.world, id).includes(u.to)) {
        if (T('risk') >= t.enforceRisk && myPower >= sidePower(u.to) * 1.5) {
          startWar(state, ctx, id, u.to, emit);
          emit({ type: 'warDeclared', attacker: id, target: u.to });
        }
      } else if (u.threat === 'sanctions' && !sanctioned(state, id, u.to)) {
        if ('accepted' in imposeSanctions(state, ctx, id, u.to))
          emit({ type: 'sanctionsImposed', from: id, to: u.to });
      }
    }

    // Wars of expansion: rare, against hostile and much weaker neighbors.
    if (enemiesAtWar(state.world, id).length === 0) {
      const targets = neighborsOf(state, ctx, country).filter(
        (x) =>
          live.has(x) &&
          !alliesOf(state.world, id).includes(x) &&
          relation(state, ctx, id, x) <= t.warRelation &&
          myPower >= sidePower(x) * t.warPower,
      );
      const target = targets.sort(
        (a, b) => relation(state, ctx, id, a) - relation(state, ctx, id, b) || (a < b ? -1 : 1),
      )[0];
      if (target && chance(state, ctx, rng, (T('expansionism') * T('risk')) / 100, r.rates.war)) {
        startWar(state, ctx, id, target, emit);
        emit({ type: 'warDeclared', attacker: id, target });
      }
    }

    // Interventionism: help partners at war (joining or aid).
    for (const partner of [...partners].filter((x) => live.has(x)).sort()) {
      if (relation(state, ctx, id, partner) < t.aidRelation) continue;
      const enemies = enemiesAtWar(state.world, partner).filter(
        (x) => x !== id && !alliesOf(state.world, id).includes(x),
      );
      if (enemies.length === 0) continue;
      const enemy = enemies[0]!;
      // Joining a war takes risk tolerance too, and much more of it against a nuclear power.
      if (
        relation(state, ctx, id, partner) >= t.interveneRelation &&
        !warBetween(state.world, id, enemy) &&
        enemy !== player &&
        (!nuclearPower(enemy) || T('risk') >= t.interveneNuclearRisk) &&
        chance(state, ctx, rng, (T('interventionism') * T('risk')) / 100, r.rates.intervene)
      ) {
        const war = warBetween(state.world, partner, enemy);
        if (war) {
          const side = war.sides[0].includes(partner) ? 0 : 1;
          war.sides[side]!.push(id);
          emit({ type: 'warJoined', countryId: id, warId: war.id, ally: partner, enemy });
        }
      } else if (chance(state, ctx, rng, T('interventionism'), r.rates.aid)) {
        sendAid(state, ctx, id, partner, Math.min(e.treasury * 0.1, e.gdp * 0.001));
      }
    }

    // War aid: a steady budget and arms program for a country at war with a country this one
    // sanctions, unless the two are on bad terms (Western aid to Ukraine). Paid every week, and
    // at a reduced rate for a while after the war (reconstruction).
    const w = r.warAid;
    if (w) {
      for (const other of [...live].sort()) {
        if (other === id) continue;
        const to = state.economy.countries[other];
        if (!to) continue;
        const enemies = enemiesAtWar(state.world, other);
        if (enemies.includes(id)) continue;
        const atWar =
          relation(state, ctx, id, other) >= w.minRelation &&
          enemies.some((x) => sanctioned(state, id, x));
        if (atWar) (to.aidFrom ??= {})[id] = state.turn + w.afterWarTurns;
        else if ((to.aidFrom?.[id] ?? -1) < state.turn) continue;
        const amount =
          ((atWar ? 1 : w.afterWarShare) *
            e.gdp *
            w.gdpSharePerYear *
            (0.5 + T('interventionism') / 100)) /
          52;
        if (amount <= 0 || e.treasury < amount * w.reserveWeeks) continue;
        e.treasury -= amount;
        to.treasury += amount;
        to.aid = (to.aid ?? 0) + amount;
      }
    }

    // Defense pacts with partners.
    for (const partner of [...partners].filter((x) => live.has(x) && x !== player).sort()) {
      if (alliesOf(state.world, id).includes(partner)) continue;
      if (relation(state, ctx, id, partner) < t.pactRelation) continue;
      // A country that wants to stay neutral proposes no pacts; one that wants an alliance
      // tries harder.
      if (pursues('neutrality')) break;
      const pactRate = r.rates.pact * (g && pursues('joinAlliance') ? g.pactFactor : 1);
      if (chance(state, ctx, rng, T('loyalty'), pactRate)) proposeAlliance(state, ctx, id, partner);
      break;
    }

    // Diplomatic initiative (GDD section 11): warm up to partners and neighbors, cool off with
    // rivals, drop pacts that have gone sour, offer pacts to a friendly player, and ask for
    // passage when a war cannot be reached over land.
    const di = r.diplomacy;
    if (di) {
      const neighbors = neighborsOf(state, ctx, country).filter((x) => live.has(x));
      if (missionsOf(state, id).length === 0) {
        const candidates = [...new Set([...partners, ...neighbors])]
          .filter(
            (x) =>
              live.has(x) &&
              x !== id &&
              !rivals.has(x) &&
              !enemiesAtWar(state.world, id).includes(x) &&
              !insultedBetween(state, id, x),
          )
          .map((x) => ({ x, r: relation(state, ctx, id, x) }))
          .filter((c) => c.r >= di.improveFrom && c.r < di.improveUpTo)
          .sort((a, b) => b.r - a.r || (a.x < b.x ? -1 : 1));
        const target = candidates[0];
        if (target && chance(state, ctx, rng, 100 - T('expansionism'), r.rates.improve ?? 0))
          improveRelations(state, ctx, id, target.x);
      }
      const rival = [...rivals]
        .filter(
          (x) =>
            live.has(x) &&
            !insultedBetween(state, id, x) &&
            relation(state, ctx, id, x) > di.insultDownTo,
        )
        .sort()[0];
      if (rival && chance(state, ctx, rng, T('pressure'), r.rates.insult ?? 0))
        insult(state, ctx, id, rival);
      // Pacts (not the big alliances) end when relations have gone sour.
      for (const al of [...state.world.alliances]) {
        if (al.type !== 'pact' || !al.members.includes(id)) continue;
        const other = al.members.find((m) => m !== id);
        if (other && relation(state, ctx, id, other) < di.cancelPactBelow)
          leaveAlliance(state, ctx, id, al.id);
      }
      // A friendly country proposes a pact to the player (answered in a notification).
      if (
        live.has(player) &&
        !pursues('neutrality') &&
        !alliesOf(state.world, id).includes(player) &&
        relation(state, ctx, id, player) >= t.pactRelation + di.playerPactMargin &&
        !rivals.has(player) &&
        chance(state, ctx, rng, T('loyalty'), r.rates.pact)
      )
        proposeAlliance(state, ctx, id, player);
      // At war with no land front: ask a neighbor that borders the enemy for passage.
      const enemies = new Set(enemiesAtWar(state.world, id));
      if (enemies.size > 0 && (state.turn + id.charCodeAt(0)) % di.accessEveryTurns === 0) {
        const land = ctx.provinceNeighbors ?? [];
        const owners = state.world.provinceOwners;
        const front = country.provinceIds.some((p) =>
          land[p]?.some((q) => enemies.has(owners[q]!)),
        );
        if (!front) {
          const canEnter = entryRule(state.world, id);
          const host = neighbors.find((h) => {
            if (canEnter(h) || h === player) return false;
            const c = state.world.countries.find((x) => x.id === h);
            return (c?.provinceIds ?? []).some((p) =>
              land[p]?.some((q) => enemies.has(owners[q]!)),
            );
          });
          if (host) requestAccess(state, ctx, id, host);
        }
      }
    }

    // Nuclear posture: a losing nuclear power threatens the player.
    const arsenal = state.weapons?.countries[id];
    const war = live.has(player) ? warBetween(state.world, id, player) : undefined;
    if (arsenal && arsenal.warheads > 0 && war && T('nuclear') >= r.nuclear.threatPosture) {
      const record = state.diplomacy.wars[war.id];
      if (record && warScore(state, war.id, id) <= r.nuclear.threatScore && !record.threatened) {
        record.threatened = true;
        emit({ type: 'nuclearThreat', from: id, to: player });
      }
    }
  }
}

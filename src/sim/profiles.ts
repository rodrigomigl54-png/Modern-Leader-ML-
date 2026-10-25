// AI behavior profiles (GDD section 11): each AI country imitates the real country's foreign
// policy through traits from data/modern/ai-profiles.json. The aggressiveness setting scales the
// hostile traits. Rules for turning traits into actions are in data/modern/ai-rules.json.
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import type { Aggressiveness } from './world';

export const TRAITS = [
  'interventionism',
  'sanctions',
  'pressure',
  'expansionism',
  'risk',
  'nuclear',
  'loyalty',
  'economy',
] as const;
export type Trait = (typeof TRAITS)[number];

/** Traits scaled by the aggressiveness setting (GDD: hostile traits only). */
export const HOSTILE_TRAITS: readonly Trait[] = [
  'interventionism',
  'sanctions',
  'pressure',
  'expansionism',
  'risk',
  'nuclear',
];

export interface AiProfile extends Record<Trait, [number, string]> {
  partners: string[];
  rivals: string[];
  derived?: boolean;
}

export interface AiRules {
  aggressiveness: Record<Aggressiveness, number>;
  chaosTimingJitter: number;
  rates: {
    sanction: number;
    ultimatum: number;
    war: number;
    intervene: number;
    aid: number;
    pact: number;
    invest: number;
    investInPlayer: number;
  };
  thresholds: {
    sanctionRelation: number;
    ultimatumRelation: number;
    ultimatumPower: number;
    warRelation: number;
    warPower: number;
    interveneRelation: number;
    /** Risk tolerance needed to join a war against a nuclear power. */
    interveneNuclearRisk: number;
    pactRelation: number;
    aidRelation: number;
    investInPlayerRelation: number;
    enforceRisk: number;
  };
  loyalty: { joinBase: number; perLoyalty: number; pactExtra: number };
  fiscal: {
    everyTurns: number;
    step: number;
    maxTax: number;
    minTax: number;
    minServices: number;
    debtLimit: number;
    lowSupport: number;
    /** Services the AI restores when the people are angry and the budget allows. */
    targetServices: number;
    /** Treasury, in weeks of spending, that counts as money in the bank. */
    reserveWeeks: number;
  };
  nuclear: { lastResortMinPosture: number; threatPosture: number; threatScore: number };
}

/** A neutral profile for countries born during the game (rebels, seceded states). */
const NEUTRAL: Record<Trait, number> = {
  interventionism: 20,
  sanctions: 10,
  pressure: 20,
  expansionism: 20,
  risk: 40,
  nuclear: 0,
  loyalty: 40,
  economy: 50,
};

export function profileOf(ctx: SimContext, id: string): AiProfile | undefined {
  return ctx.profiles?.[id];
}

/** A trait of a country after the aggressiveness setting (0-100). */
export function trait(state: GameState, ctx: SimContext, id: string, t: Trait): number {
  const base = profileOf(ctx, id)?.[t]?.[0] ?? NEUTRAL[t];
  if (!HOSTILE_TRAITS.includes(t) || !ctx.aiRules) return base;
  const level = state.settings.aggressiveness;
  if (level === 'chaos') return 100;
  return Math.min(100, base * ctx.aiRules.aggressiveness[level]);
}

/** Relation an alliance member needs with the attacked ally to join its war (loyalty). */
export function joinThreshold(
  state: GameState,
  ctx: SimContext,
  id: string,
  type: 'alliance' | 'pact',
): number | null {
  const r = ctx.aiRules?.loyalty;
  if (!r) return null;
  const loyalty = trait(state, ctx, id, 'loyalty');
  return r.joinBase - loyalty * r.perLoyalty + (type === 'pact' ? r.pactExtra : 0);
}

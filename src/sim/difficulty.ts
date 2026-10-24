// Automatic difficulty rating (GDD section 3): computed from data only, 1 star = easiest.
import {
  alliesOf,
  enemiesAtWar,
  playableCountries,
  rivalsOf,
  type World,
  type WorldCountry,
} from './world';

export type Stars = 1 | 2 | 3 | 4 | 5;

/** Weights of the factors; each factor is a percentile rank among playable countries (1 = best). */
export const DIFFICULTY_WEIGHTS = {
  power: 0.65,
  gdpPerCapita: 0.15,
  stability: 0.1,
  alliances: 0.1,
} as const;
/** Score subtracted while the country is at war. */
export const WAR_PENALTY = 0.05;
/** Share of playable countries per star, from 1 (easiest) to 5 (hardest). */
export const STAR_SHARES = [0.1, 0.15, 0.2, 0.25, 0.3] as const;

/** Raw strength of a country: economy, military spending and manpower on a log scale. */
export function powerOf(c: WorldCountry): number | null {
  const { gdpUsd, militaryExpenditureUsd, militaryPersonnel } = c.stats;
  if (gdpUsd === null) return null;
  const spending = militaryExpenditureUsd ?? gdpUsd * 0.015;
  return (
    0.5 * Math.log10(gdpUsd) +
    0.3 * Math.log10(spending + 1) +
    0.2 * Math.log10((militaryPersonnel ?? 0) + 1)
  );
}

/** Percentile rank in [0, 1] for each value; null values get the given fallback rank. */
export function percentileRanks(values: (number | null)[], fallback: number): number[] {
  const known = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return values.map((v) => {
    if (v === null) return fallback;
    if (known.length <= 1) return 0.5;
    // Average position of equal values, so ties get the same rank.
    let lo = 0;
    while (known[lo]! < v) lo++;
    let hi = lo;
    while (hi + 1 < known.length && known[hi + 1] === v) hi++;
    return (lo + hi) / 2 / (known.length - 1);
  });
}

export interface DifficultyResult {
  stars: Stars;
  score: number;
}

export function computeDifficulty(world: World): Map<string, DifficultyResult> {
  const countries = playableCountries(world);
  const power = countries.map(powerOf);
  const powerById = new Map(countries.map((c, i) => [c.id, power[i] ?? null]));
  for (const c of world.countries) if (!powerById.has(c.id)) powerById.set(c.id, powerOf(c));

  const gdpPerCapita = countries.map((c) =>
    c.stats.gdpUsd !== null && c.stats.population ? c.stats.gdpUsd / c.stats.population : null,
  );
  const stability = countries.map((c) => c.stats.stability);
  // Allies help, rivals hurt: compare the combined (linear) strength of both groups.
  const strength = (id: string): number => 10 ** (powerById.get(id) ?? 0) / 1e9;
  const alliance = countries.map((c) => {
    const allied = alliesOf(world, c.id).reduce((t, id) => t + strength(id), 0);
    const rival = rivalsOf(world, c.id).reduce((t, id) => t + strength(id), 0);
    return Math.log10(1 + allied) - Math.log10(1 + rival);
  });

  // Missing data counts as weak: unknown values are usually small states.
  const ranks = {
    power: percentileRanks(power, 0.1),
    gdpPerCapita: percentileRanks(gdpPerCapita, 0.25),
    stability: percentileRanks(stability, 0.25),
    alliances: percentileRanks(alliance, 0.5),
  };
  const scores = countries.map((c, i) => {
    let s =
      DIFFICULTY_WEIGHTS.power * ranks.power[i]! +
      DIFFICULTY_WEIGHTS.gdpPerCapita * ranks.gdpPerCapita[i]! +
      DIFFICULTY_WEIGHTS.stability * ranks.stability[i]! +
      DIFFICULTY_WEIGHTS.alliances * ranks.alliances[i]!;
    if (enemiesAtWar(world, c.id).length > 0) s -= WAR_PENALTY;
    return s;
  });

  // Highest scores are easiest; ties are broken by id so the result is deterministic.
  const order = countries
    .map((_, i) => i)
    .sort((a, b) => scores[b]! - scores[a]! || (countries[a]!.id < countries[b]!.id ? -1 : 1));
  const result = new Map<string, DifficultyResult>();
  // The position in the ranking (0 = strongest) decides the star, so the strongest country
  // always gets 1 star even in a small list.
  const cumulative = STAR_SHARES.map((_, i) =>
    STAR_SHARES.slice(0, i + 1).reduce((t, v) => t + v, 0),
  );
  order.forEach((index, position) => {
    const share = position / order.length;
    const star = cumulative.findIndex((c) => share < c - 1e-9);
    result.set(countries[index]!.id, {
      stars: ((star < 0 ? STAR_SHARES.length - 1 : star) + 1) as Stars,
      score: scores[index]!,
    });
  });
  return result;
}

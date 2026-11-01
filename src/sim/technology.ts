// Technology (Dario, Phase 26, after Age of History): a country spends a share of its GDP on
// research; the money fills progress toward the next technology level, and every level brings
// points to assign to lasting bonuses (growth, taxes, upkeep, investment, research, stability,
// administration). Rules are in data/modern/economy.json ("technology").

export type TechCategory =
  | 'gdpGrowth'
  | 'taxes'
  | 'militaryUpkeep'
  | 'investmentCost'
  | 'research'
  | 'stability'
  | 'administration';

export const TECH_CATEGORIES: readonly TechCategory[] = [
  'gdpGrowth',
  'taxes',
  'militaryUpkeep',
  'investmentCost',
  'research',
  'stability',
  'administration',
];

export interface TechRules {
  /** Research spending at the start and its limits, as shares of GDP. */
  startResearch: number;
  minResearch: number;
  maxResearch: number;
  /** A level costs this share of GDP, growing by levelCostGrowth per level gained. */
  levelGdpShare: number;
  levelCostGrowth: number;
  pointsPerLevel: number;
  /** Starting index from GDP per person: index at 1,000 USD and per factor of ten above it. */
  startIndexAt1000: number;
  startIndexPerDecade: number;
  minStartIndex: number;
  maxStartIndex: number;
  /** Index gained per level; starting points per 0.1 of index. */
  indexPerLevel: number;
  startPointsPerTenth: number;
  /** Most points and the effect of one point, per category. */
  categories: Record<TechCategory, { max: number; perPoint: number }>;
  /** Order in which AI countries assign their points. */
  aiOrder: TechCategory[];
}

/** A country's technology. */
export interface TechState {
  /** Index at the start (from GDP per person), shown as the technology level. */
  start: number;
  /** Levels gained since the start. */
  levels: number;
  /** Research money toward the next level (USD). */
  progress: number;
  /** Points not assigned yet. */
  points: number;
  /** Points assigned per category. */
  spent: Partial<Record<TechCategory, number>>;
}

/** Starting technology from GDP per person (richer countries start further ahead). */
export function startingTech(rules: TechRules, gdp: number, population: number): TechState {
  const perPerson = population > 0 ? gdp / population : 1000;
  const index = Math.min(
    rules.maxStartIndex,
    Math.max(
      rules.minStartIndex,
      rules.startIndexAt1000 +
        rules.startIndexPerDecade * Math.log10(Math.max(1, perPerson / 1000)),
    ),
  );
  return {
    start: Math.round(index * 100) / 100,
    levels: 0,
    progress: 0,
    points: Math.round(index * 10 * rules.startPointsPerTenth),
    spent: {},
  };
}

/** The technology level shown to players (0.25 … 1.00 and up). */
export function techIndex(rules: TechRules, tech: TechState): number {
  return tech.start + tech.levels * rules.indexPerLevel;
}

/** Research money the next level needs. */
export function levelCostUsd(rules: TechRules, tech: TechState, gdp: number): number {
  return gdp * rules.levelGdpShare * (1 + rules.levelCostGrowth) ** tech.levels;
}

/** The size of a bonus: points in the category times its effect per point. */
export function techBonus(
  rules: TechRules | undefined,
  tech: TechState | undefined,
  category: TechCategory,
): number {
  if (!rules || !tech) return 0;
  return (tech.spent[category] ?? 0) * rules.categories[category].perPoint;
}

/** Assigns one point; false when none is left or the category is full. */
export function assignPoint(rules: TechRules, tech: TechState, category: TechCategory): boolean {
  const have = tech.spent[category] ?? 0;
  if (tech.points < 1 || have >= rules.categories[category].max) return false;
  tech.points -= 1;
  tech.spent[category] = have + 1;
  return true;
}

/** AI countries assign their points in a fixed order of priorities. */
export function aiAssignPoints(rules: TechRules, tech: TechState): void {
  for (const category of rules.aiOrder)
    while (assignPoint(rules, tech, category)) if (tech.points < 1) return;
}

/**
 * One week of research: the money (sped up by the research bonus) fills progress; each full
 * level adds points. Returns the number of levels gained.
 */
export function researchWeek(
  rules: TechRules,
  tech: TechState,
  gdp: number,
  money: number,
): number {
  tech.progress += money * (1 + techBonus(rules, tech, 'research'));
  let gained = 0;
  for (let cost = levelCostUsd(rules, tech, gdp); tech.progress >= cost && gained < 5;) {
    tech.progress -= cost;
    tech.levels += 1;
    tech.points += rules.pointsPerLevel;
    gained++;
    cost = levelCostUsd(rules, tech, gdp);
  }
  return gained;
}

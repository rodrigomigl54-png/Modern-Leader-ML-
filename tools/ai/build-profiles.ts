// Builds data/modern/ai-profiles.json (GDD section 11): the hand-written profiles in
// tools/ai/manual-profiles.json, and for every other country a profile derived from data
// (alliances, rivalries, wars, sanctions, military spending, mandatory service, nuclear weapons),
// each score with a one-line justification. Usage: npm run data:profiles
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../map/paths.ts';

type Trait =
  | 'interventionism'
  | 'sanctions'
  | 'pressure'
  | 'expansionism'
  | 'risk'
  | 'nuclear'
  | 'loyalty'
  | 'economy';
type Scored = [number, string];
type Profile = Record<Trait, Scored> & { partners: string[]; rivals: string[]; derived?: boolean };

const read = <T>(file: string): T => JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;
const manual = JSON.parse(
  readFileSync(new URL('./manual-profiles.json', import.meta.url), 'utf8'),
) as {
  profiles: Record<string, Profile>;
};
const countries = read<{ countries: { id: string; status: string }[] }>('countries.json').countries;
const diplomacy = read<{
  alliances: { id: string; type: string; members: string[] }[];
  rivalries: { a: string; b: string }[];
  wars: { sides: [string[], string[]] }[];
}>('diplomacy.json');
const stats = read<{
  stats: Record<string, { gdpUsd?: number; militaryExpenditureUsd?: number; population?: number }>;
}>('country-stats.json').stats;
const service = new Set(read<{ service: string[] }>('military-service.json').service);
const nuclear = read<{ nuclear: { countries: Record<string, unknown> } }>('weapons.json').nuclear
  .countries;
const relations = read<{
  pairs: { a: string; b: string; value: number }[];
  sanctions: { from: string; to: string }[];
}>('relations.json');

const allianceNames: Record<string, string> = {
  nato: 'NATO',
  eu: 'the EU',
  csto: 'the CSTO',
  gcc: 'the GCC',
  aes: 'the Alliance of Sahel States',
};
const clamp = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

function derive(id: string): Profile {
  const s = stats[id] ?? {};
  const share =
    s.gdpUsd && s.militaryExpenditureUsd ? (s.militaryExpenditureUsd / s.gdpUsd) * 100 : null;
  const spending =
    share === null
      ? 'No reliable military spending data'
      : `Military spending ${share.toFixed(1)}% of GDP (SIPRI)`;
  const alliances = diplomacy.alliances.filter((a) => a.members.includes(id));
  const defense = alliances.filter((a) => a.type === 'alliance');
  const pacts = alliances.filter((a) => a.type === 'pact');
  const names = alliances.map(
    (a) => allianceNames[a.id] ?? `a pact with ${a.members.filter((m) => m !== id).join(', ')}`,
  );
  const rivals = diplomacy.rivalries.flatMap((r) => (r.a === id ? [r.b] : r.b === id ? [r.a] : []));
  const atWar = diplomacy.wars.some((w) => w.sides[0].includes(id) || w.sides[1].includes(id));
  const attacker = diplomacy.wars.some((w) => w.sides[0].includes(id));
  const sanctionsSent = relations.sanctions.filter((x) => x.from === id).map((x) => x.to);
  const inEu = alliances.some((a) => a.id === 'eu');
  const gdpPerCapita = s.gdpUsd && s.population ? s.gdpUsd / s.population : null;
  const partners = [
    ...relations.pairs
      .filter((p) => p.value >= 40 && (p.a === id || p.b === id))
      .map((p) => (p.a === id ? p.b : p.a)),
    ...pacts
      .filter((a) => a.members.length === 2)
      .flatMap((a) => a.members.filter((m) => m !== id)),
  ];

  const intervention = clamp(10 + defense.length * 10 + (share !== null && share >= 3 ? 15 : 0));
  const sanctions = inEu
    ? ([45, 'Applies the EU common sanctions'] as Scored)
    : sanctionsSent.length
      ? ([45, `Sanctions in force on ${[...new Set(sanctionsSent)].join(', ')}`] as Scored)
      : ([10, 'No sanctions regime of its own'] as Scored);
  const pressure = clamp(10 + rivals.length * 10);
  const expansion = clamp(5 + (attacker ? 40 : 0) + (rivals.length > 0 ? 10 : 0));
  const drafted = service.has(id);
  const risk = clamp(10 + (share ?? 1) * 4 + (atWar ? 20 : 0) + (drafted ? 5 : 0));
  const loyalty = defense.length ? 60 : pacts.length ? 50 : 30;
  const economy = clamp(
    50 +
      (gdpPerCapita !== null && gdpPerCapita > 20000
        ? 20
        : gdpPerCapita !== null && gdpPerCapita < 3000
          ? -15
          : 0) -
      (share ?? 1) * 3,
  );
  const why = (...parts: (string | false)[]): string => parts.filter(Boolean).join('; ');
  return {
    interventionism: [
      intervention,
      why(
        defense.length > 0 &&
          `Member of ${names.filter((_, i) => alliances[i]!.type === 'alliance').join(' and ')}`,
        spending,
      ) || spending,
    ],
    sanctions,
    pressure: [
      pressure,
      rivals.length ? `Documented rivalries with ${rivals.join(', ')}` : 'No documented rivalries',
    ],
    expansionism: [
      expansion,
      why(
        attacker && 'Started a war still active at the start',
        rivals.length > 0 && 'Has territorial or political disputes with rivals',
      ) || 'No territorial claims documented',
    ],
    risk: [
      risk,
      why(atWar && 'At war at the start', spending, drafted && 'Mandatory military service'),
    ],
    nuclear: nuclear[id] ? [40, 'Has nuclear weapons (SIPRI)'] : [0, 'No nuclear weapons'],
    loyalty: [
      loyalty,
      names.length ? `Member of ${names.join(', ')}` : 'No alliances or defense pacts',
    ],
    economy: [
      economy,
      why(
        gdpPerCapita !== null &&
          `GDP per person ${Math.round(gdpPerCapita).toLocaleString('en')} USD`,
        spending,
      ),
    ],
    partners: [...new Set(partners)].slice(0, 4),
    rivals,
    derived: true,
  };
}

const profiles: Record<string, Profile> = {};
for (const c of countries) {
  if (c.status === 'uninhabited') continue;
  profiles[c.id] = manual.profiles[c.id] ?? derive(c.id);
}
const out = {
  meta: {
    description:
      'AI behavior profiles (GDD section 11). Traits 0-100, each [score, one-line justification]. Hand-written profiles come from tools/ai/manual-profiles.json; the rest ("derived": true) are computed from the game data by tools/ai/build-profiles.ts. Generated file: do not edit by hand.',
    source:
      'tools/ai/manual-profiles.json and data/modern (alliances, rivalries, wars, sanctions, SIPRI spending, nuclear forces)',
    generatedBy: 'tools/ai/build-profiles.ts',
    checked: new Date().toISOString().slice(0, 10),
    checkedBy: 'draft — needs review by Dario',
  },
  profiles,
};
writeFileSync(join(DATA_DIR, 'ai-profiles.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `ai-profiles.json: ${Object.keys(profiles).length} profiles (${Object.values(profiles).filter((p) => !p.derived).length} hand-written)`,
);

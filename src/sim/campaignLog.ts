// The campaign's history (master plan, phase 7): a log of the important events of one game, for
// the player to look back on. Entries concern the player's country, plus the great world events
// (wars, peace, conquests, revolutions, nuclear strikes). Small things are left out or summed up
// once per week (battles, finished buildings), so the history stays readable. It never changes
// the game; it only records. Saved with the game; older saves start an empty log.
import type { GameState } from './newGame';
import type { TurnEvent } from './turn';

export type LogCategory =
  'war' | 'territory' | 'peace' | 'economy' | 'technology' | 'diplomacy' | 'politics' | 'national';

export const LOG_CATEGORIES: readonly LogCategory[] = [
  'war',
  'territory',
  'peace',
  'economy',
  'technology',
  'diplomacy',
  'politics',
  'national',
];

export type LogKind =
  | 'start'
  | 'war'
  | 'warJoined'
  | 'battles'
  | 'provinceTaken'
  | 'provinceLost'
  | 'conquered'
  | 'peace'
  | 'buildings'
  | 'inflation'
  | 'techLevel'
  | 'alliance'
  | 'sanctionsOnUs'
  | 'sanctionsByUs'
  | 'globalSanctions'
  | 'nuclear'
  | 'ultimatumAccepted'
  | 'ultimatumRefused'
  | 'riots'
  | 'revolution'
  | 'revolutionCrushed'
  | 'revolutionWon'
  | 'secession'
  | 'credibility'
  | 'goalDone'
  | 'goalFailed'
  | 'event'
  | 'objective';

export interface LogEntry {
  turn: number;
  category: LogCategory;
  kind: LogKind;
  /** Countries named in the entry, in the order its text names them. */
  a?: string;
  b?: string;
  /** A count (battles won, buildings, provinces) or a province id, by kind. */
  n?: number;
  m?: number;
  /** Extra text id (goal kind, building category, event id). */
  extra?: string;
}

export interface CampaignLog {
  entries: LogEntry[];
  knownWars: string[];
  knownAlliances: string[];
}

/** Old entries beyond this are dropped (the start entry stays). */
export const MAX_LOG = 600;

export function emptyLog(state: Pick<GameState, 'world' | 'turn' | 'player'>): CampaignLog {
  return {
    entries: [
      {
        turn: state.turn,
        category: 'national',
        kind: 'start',
        a: state.player.countryId,
      },
    ],
    knownWars: state.world.wars.map((w) => w.id),
    knownAlliances: state.world.alliances.map((a) => a.id),
  };
}

/** Adds an entry outside the turn (events and objectives use it too). */
export function logEntry(state: GameState, entry: Omit<LogEntry, 'turn'>): void {
  const log = (state.log ??= emptyLog(state));
  log.entries.push({ turn: state.turn, ...entry });
  if (log.entries.length > MAX_LOG)
    log.entries = [log.entries[0]!, ...log.entries.slice(-(MAX_LOG - 1))];
}

/** Turn step 9: records this week's important events. */
export function recordLog(state: GameState, events: readonly TurnEvent[]): void {
  const log = (state.log ??= emptyLog(state));
  const me = state.player.countryId;
  const add = (entry: Omit<LogEntry, 'turn'>): void => logEntry(state, entry);

  // New wars anywhere (revolutions are logged as revolutions).
  for (const w of state.world.wars) {
    if (log.knownWars.includes(w.id) || w.id.startsWith('revolution-')) continue;
    add({ category: 'war', kind: 'war', a: w.sides[0][0], b: w.sides[1][0] });
  }
  log.knownWars = state.world.wars.map((w) => w.id);
  // New alliances and pacts the player signed.
  for (const al of state.world.alliances) {
    if (log.knownAlliances.includes(al.id) || al.type === 'vassal') continue;
    if (al.members.includes(me))
      add({ category: 'diplomacy', kind: 'alliance', a: al.members.find((x) => x !== me) });
  }
  log.knownAlliances = state.world.alliances.map((a) => a.id);

  let won = 0;
  let lost = 0;
  const built = new Map<string, number>();
  for (const e of events) {
    switch (e.type) {
      case 'battle': {
        const ours = e.attacker === me ? 'attacker' : e.defender === me ? 'defender' : null;
        if (ours) {
          if (e.winner === ours) won++;
          else lost++;
        }
        break;
      }
      case 'warJoined':
        if (e.ally === me || e.enemy === me)
          add({ category: 'war', kind: 'warJoined', a: e.countryId, b: e.enemy });
        break;
      case 'provinceCaptured':
        if (e.to === me)
          add({ category: 'territory', kind: 'provinceTaken', a: e.from, n: e.provinceId });
        else if (e.from === me)
          add({ category: 'territory', kind: 'provinceLost', a: e.to, n: e.provinceId });
        break;
      case 'countryConquered':
        add({ category: 'territory', kind: 'conquered', a: e.countryId, b: e.by });
        break;
      case 'peace':
        add({ category: 'peace', kind: 'peace', a: e.a, b: e.b });
        break;
      case 'buildingCompleted':
        if (e.owner === me) {
          const b = state.economy.buildings.find((x) => x.id === e.buildingId);
          if (b) built.set(b.category, (built.get(b.category) ?? 0) + 1);
        }
        break;
      case 'inflationAlert':
        if (e.countryId === me)
          add({ category: 'economy', kind: 'inflation', n: Math.round(e.inflation * 100) });
        break;
      case 'techLevel':
        if (e.countryId === me) add({ category: 'technology', kind: 'techLevel', n: e.points });
        break;
      case 'sanctionsImposed':
        if (e.to === me) add({ category: 'diplomacy', kind: 'sanctionsOnUs', a: e.from });
        else if (e.from === me) add({ category: 'diplomacy', kind: 'sanctionsByUs', a: e.to });
        break;
      case 'globalSanctions':
        add({ category: 'diplomacy', kind: 'globalSanctions', a: e.countryId });
        break;
      case 'nuclearStrike':
        add({ category: 'war', kind: 'nuclear', a: e.attacker, b: e.defender, n: e.cityId });
        break;
      case 'ultimatumAnswered':
        if (e.from === me || e.to === me)
          add({
            category: 'diplomacy',
            kind: e.accepted ? 'ultimatumAccepted' : 'ultimatumRefused',
            a: e.from,
            b: e.to,
          });
        break;
      case 'riotsStarted':
        if (e.countryId === me) add({ category: 'politics', kind: 'riots', n: e.provinces });
        break;
      case 'revolution':
        add({ category: 'politics', kind: 'revolution', a: e.countryId });
        break;
      case 'revolutionCrushed':
        add({ category: 'politics', kind: 'revolutionCrushed', a: e.countryId });
        break;
      case 'revolutionSucceeded':
        add({ category: 'politics', kind: 'revolutionWon', a: e.countryId });
        break;
      case 'secession':
        add({ category: 'politics', kind: 'secession', a: e.newCountryId, b: e.countryId });
        break;
      case 'credibilityLost':
        if (e.countryId === me) add({ category: 'diplomacy', kind: 'credibility' });
        break;
      case 'goalDone':
      case 'goalFailed':
        add({ category: 'national', kind: e.type, extra: e.kind });
        break;
    }
  }
  if (won + lost > 0) add({ category: 'war', kind: 'battles', n: won, m: lost });
  for (const [category, count] of built)
    add({ category: 'economy', kind: 'buildings', n: count, extra: category });
}

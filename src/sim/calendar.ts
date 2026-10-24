// Game calendar: one turn is one week, 52 turns per year (GDD section 5).

export const DAYS_PER_TURN = 7;
export const TURNS_PER_YEAR = 52;
export const REPORT_INTERVAL = 10;

/** Adds days to an ISO date (YYYY-MM-DD), in UTC so it never depends on the device's time zone. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Date of a turn, counting from the scenario start date. */
export function dateOfTurn(startDate: string, turn: number): string {
  return addDays(startDate, turn * DAYS_PER_TURN);
}

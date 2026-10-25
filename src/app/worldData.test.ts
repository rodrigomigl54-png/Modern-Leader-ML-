import { describe, expect, it } from 'vitest';
import { provincePopulation, type MapFacts } from './worldData';

describe('province population', () => {
  it('adds the people outside the listed cities by area, so no province is empty', () => {
    const province = (id: number, areaKm2: number) =>
      ({ id, owner: 'AAA', areaKm2 }) as MapFacts['provinces'][number];
    const map = {
      provinces: [province(0, 100), province(1, 300)],
      countries: [],
      cities: [{ provinceId: 0, population: 1000 }],
    } as unknown as MapFacts;
    const pop = provincePopulation(map, { stats: { AAA: { population: 5000 } } });
    expect(pop[0]).toBeCloseTo(1000 + 1000, 6);
    expect(pop[1]).toBeCloseTo(3000, 6);
    // Without statistics only the cities count.
    expect(provincePopulation(map, null)).toEqual([1000, 0]);
  });
});

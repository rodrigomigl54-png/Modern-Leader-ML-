import { describe, expect, it } from 'vitest';
import { initials } from './leaderSeal';

describe('leader seal initials', () => {
  it('takes the first letters of the first and last name', () => {
    expect(initials('Aleksandar Vučić')).toBe('AV');
    expect(initials('  Ana   Brnabić ')).toBe('AB');
    expect(initials('Lula')).toBe('L');
    expect(initials('Recep Tayyip Erdoğan')).toBe('RE');
    expect(initials('Šime Đurić')).toBe('ŠĐ');
    expect(initials('')).toBe('?');
  });
});

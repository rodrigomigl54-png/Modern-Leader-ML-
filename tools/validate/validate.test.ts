import { describe, expect, it } from 'vitest';
import { validateModernData } from './validate.ts';

describe('data/modern', () => {
  it('passes validation', { timeout: 180_000 }, () => {
    const result = validateModernData();
    expect(result.errors).toEqual([]);
  });
});

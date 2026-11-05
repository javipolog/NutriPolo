import { describe, it, expect } from 'vitest';
import { clientMatcher } from './search';

// Invented people only.
const ana = { nombre: 'María Ánjeles Núñez', email: 'Maria.N@example.com', telefono: '+34 600 11 22 33' };

describe('clientMatcher', () => {
  it('ignores accents and case', () => {
    expect(clientMatcher('maria anjeles')(ana)).toBe(true);
    expect(clientMatcher('NUÑEZ')(ana)).toBe(true);
    expect(clientMatcher('maria.n@')(ana)).toBe(true);
    expect(clientMatcher('pedro')(ana)).toBe(false);
  });

  it('compares phones by their digits', () => {
    expect(clientMatcher('600112233')(ana)).toBe(true);
    expect(clientMatcher('600 11 22')(ana)).toBe(true);
    expect(clientMatcher('0034600112233')(ana)).toBe(true);
    expect(clientMatcher('611')(ana)).toBe(false);
  });

  it('matches everyone with an empty query', () => {
    expect(clientMatcher('  ')(ana)).toBe(true);
  });
});

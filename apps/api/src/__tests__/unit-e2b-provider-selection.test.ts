/**
 * Provider selection for E2B: ALLOWED_SANDBOX_PROVIDERS parsing, enablement,
 * and default-provider order. Pure config helpers — no live E2B SDK calls.
 */
import { describe, expect, test } from 'bun:test';
import { KNOWN_PROVIDERS, parseAllowedProviders } from '../config';

describe('E2B provider selection (config)', () => {
  test('KNOWN_PROVIDERS lists e2b alongside platinum and daytona', () => {
    expect(KNOWN_PROVIDERS).toContain('e2b');
    expect(KNOWN_PROVIDERS).toEqual(['platinum', 'daytona', 'e2b']);
  });

  test('parseAllowedProviders accepts e2b as the sole / default provider', () => {
    expect(parseAllowedProviders('e2b')).toEqual(['e2b']);
    expect(parseAllowedProviders('e2b,platinum')).toEqual(['e2b', 'platinum']);
    expect(parseAllowedProviders('platinum,e2b,daytona')).toEqual([
      'platinum',
      'e2b',
      'daytona',
    ]);
  });

  test('parseAllowedProviders dedupes and ignores unknown names', () => {
    expect(parseAllowedProviders('e2b,e2b,garbage')).toEqual(['e2b']);
  });

  test('first entry is the default (tunnel skip uses this for e2b)', () => {
    const providers = parseAllowedProviders('e2b,platinum');
    expect(providers[0]).toBe('e2b');
  });
});

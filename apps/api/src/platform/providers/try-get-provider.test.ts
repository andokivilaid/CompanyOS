import { describe, expect, test } from 'bun:test';
import { tryGetProvider } from './index';

describe('tryGetProvider', () => {
  test('returns null for an unknown/retired provider name instead of throwing', () => {
    // A legacy runtime can name a provider this build no longer knows. getProvider
    // throws for it; tryGetProvider must swallow that so teardown can proceed.
    expect(tryGetProvider('some-retired-provider')).toBeNull();
  });

  test('returns null for e2b when E2B_API_KEY is unset on this process', () => {
    // Same contract as platinum/daytona without their keys: getProvider throws,
    // tryGetProvider swallows so teardown of a row whose key is gone still works.
    expect(tryGetProvider('e2b')).toBeNull();
  });

  test('never throws, whatever the provider string', () => {
    // Disabled providers (API key unset) throw inside getProvider; tryGetProvider
    // converts every such failure to null.
    for (const name of ['platinum', 'daytona', 'e2b', '', 'garbage']) {
      expect(() => tryGetProvider(name)).not.toThrow();
    }
  });
});

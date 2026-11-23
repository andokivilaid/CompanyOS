/** Sandbox provider names, order and labels. Platinum is the reference provider. */

const PROVIDER_LABEL: Record<string, string> = {
  platinum: 'Platinum',
  daytona: 'Daytona',
  e2b: 'E2B',
};

/** Platinum is the reference provider. Daytona is a legacy fallback with removal scheduled. */
export function isLegacySandboxProvider(provider: string): boolean {
  return provider === 'daytona';
}

/** Sort key: Platinum first, then E2B, legacy providers last. */
export function sandboxProviderRank(provider: string): number {
  if (provider === 'platinum') return 0;
  if (provider === 'e2b') return 1;
  return isLegacySandboxProvider(provider) ? 3 : 2;
}

export function sortSandboxProviders<T extends string>(providers: readonly T[]): T[] {
  return [...providers].sort((a, b) => sandboxProviderRank(a) - sandboxProviderRank(b));
}

export function formatSandboxProvider(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

/** `Platinum`, `Platinum and Daytona`. */
export function formatSandboxProviders(providers: readonly string[]): string {
  const names = sortSandboxProviders(providers).map(formatSandboxProvider);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

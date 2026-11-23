import { expect, test } from 'bun:test';
import type {
  AppHostingProvider,
  CreateProjectSessionInput,
  KortixProject,
  ProjectSessionSandbox,
  SandboxProviderName,
} from './index';
import { updateWorkspaceSandboxProvider } from './index';

test('Platinum, Daytona, and E2B are accepted anywhere consumers select or observe a sandbox provider', () => {
  const platformProvider: SandboxProviderName = 'platinum';
  const runtimeProvider: ProjectSessionSandbox['provider'] = 'platinum';
  const createProvider: NonNullable<CreateProjectSessionInput['provider']> = 'platinum';
  const projectProvider: NonNullable<KortixProject['default_sandbox_provider']> = 'platinum';
  const availableProvider: NonNullable<KortixProject['available_sandbox_providers']>[number] = 'daytona';
  const updateProvider: NonNullable<Parameters<typeof updateWorkspaceSandboxProvider>[1]> = 'daytona';
  const appProvider: AppHostingProvider = 'platinum';
  const e2bProvider: SandboxProviderName = 'e2b';
  const e2bRuntime: ProjectSessionSandbox['provider'] = 'e2b';
  const e2bCreate: NonNullable<CreateProjectSessionInput['provider']> = 'e2b';
  const e2bProjectPin: NonNullable<KortixProject['default_sandbox_provider']> = 'e2b';
  const e2bUpdate: NonNullable<Parameters<typeof updateWorkspaceSandboxProvider>[1]> = 'e2b';
  const e2bApp: AppHostingProvider = 'e2b';

  expect([
    platformProvider,
    runtimeProvider,
    createProvider,
    projectProvider,
    availableProvider,
    updateProvider,
    appProvider,
    e2bProvider,
    e2bRuntime,
    e2bCreate,
    e2bProjectPin,
    e2bUpdate,
    e2bApp,
  ]).toEqual([
    'platinum',
    'platinum',
    'platinum',
    'platinum',
    'daytona',
    'daytona',
    'platinum',
    'e2b',
    'e2b',
    'e2b',
    'e2b',
    'e2b',
    'e2b',
  ]);
});

test('retired providers (managed, justavps) are rejected by every public provider contract', () => {
  // @ts-expect-error managed is not a sandbox provider
  const managed: SandboxProviderName = 'managed';
  // @ts-expect-error justavps is not a sandbox provider
  const justavps: NonNullable<CreateProjectSessionInput['provider']> = 'justavps';
  // @ts-expect-error retired providers cannot be persisted as project pins
  const retiredProjectPin: NonNullable<KortixProject['default_sandbox_provider']> = 'managed';
  // @ts-expect-error retired providers cannot be sent by the project pin mutation
  const retiredUpdate: NonNullable<Parameters<typeof updateWorkspaceSandboxProvider>[1]> = 'managed';

  expect([managed, justavps, retiredProjectPin, retiredUpdate]).toHaveLength(4);
});

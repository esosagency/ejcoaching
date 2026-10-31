import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ selections: [] as unknown[][], values: null as Record<string, unknown> | null, updates: null as Record<string, unknown> | null }));
vi.mock('drizzle-orm/mysql2', () => ({
  drizzle: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => state.selections.shift() ?? [] }) }) }),
    insert: () => ({ values: (values: Record<string, unknown>) => {
      state.values = values;
      return { onDuplicateKeyUpdate: async ({ set }: { set: Record<string, unknown> }) => { state.updates = set; } };
    } }),
  }),
}));
import { upsertUser } from './db';

describe('explicit administrator allowlist', () => {
  beforeEach(() => { vi.stubEnv('DATABASE_URL', 'mysql://unit-test.invalid/test'); state.selections = []; state.values = null; state.updates = null; });
  afterEach(() => { vi.unstubAllEnvs(); });
  it('ignores an injected admin role when the OAuth email is not authorized', async () => {
    state.selections = [[], []];
    const input = { openId: 'unit-identity', email: 'not-authorized@example.com', role: 'admin' };
    await upsertUser(input);
    expect(state.values?.role).toBe('user');
    expect(state.updates?.role).toBe('user');
  });
  it('grants admin only when the normalized OAuth email is allowlisted', async () => {
    state.selections = [[], [{ email: 'owner@example.com' }]];
    await upsertUser({ openId: 'unit-identity', email: ' Owner@Example.com ' });
    expect(state.values?.email).toBe('owner@example.com');
    expect(state.values?.role).toBe('admin');
  });
  it('revokes an existing admin when the refreshed OAuth email is no longer authorized', async () => {
    state.selections = [[{ openId: 'unit-identity', email: 'owner@example.com', role: 'admin' }], []];
    await upsertUser({ openId: 'unit-identity', email: 'new-email@example.com' });
    expect(state.updates?.email).toBe('new-email@example.com');
    expect(state.updates?.role).toBe('user');
  });
});

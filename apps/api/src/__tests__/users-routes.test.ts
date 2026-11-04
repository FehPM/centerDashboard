import { Prisma, type PrismaClient } from '@prisma/client';
import type { MetricGateway } from '@center/mcp-core';
import { Pseudonymizer } from '@center/pii';
import { SecretBox } from '@center/secrets';
import { buildServer } from '../server.js';
import { hashPassword } from '../auth/password.js';
import { testConfig } from './helpers/config.js';

interface FakeUser {
  id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; organizationId: string;
  passwordHash: string; active: boolean; mustChangePassword: boolean; passwordChangedAt?: Date | null;
}

const long = (moduleKey: string) => ({
  moduleKey, status: 'ACTIVE' as const, startsAt: new Date('2020-01-01'), endsAt: null,
});

async function setup(role: 'ADMIN' | 'MEMBER' = 'ADMIN') {
  const passwordHash = await hashPassword('segredo123');
  const users: FakeUser[] = [
    { id: 'user_1', email: 'ana@example.com', name: 'Ana', role, organizationId: 'org_1', passwordHash, active: true, mustChangePassword: false },
    { id: 'user_2', email: 'bia@example.com', name: 'Bia', role: 'MEMBER', organizationId: 'org_1', passwordHash, active: true, mustChangePassword: false },
    { id: 'user_other', email: 'zed@other.com', name: 'Zed', role: 'MEMBER', organizationId: 'org_2', passwordHash, active: true, mustChangePassword: false },
  ];
  let grants: Array<{ userId: string; moduleKey: string; grantedByUserId?: string | null }> = [
    { userId: 'user_2', moduleKey: 'overview' },
  ];
  const match = (u: FakeUser, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, v]) => {
      const value = (u as never)[k];
      if (typeof v !== 'object' || v === null) return value === v;
      const inList = (v as { in?: unknown[] }).in;
      return inList ? inList.includes(value) : true;
    });
  const withAccess = (u: FakeUser) => ({
    ...u, moduleAccess: grants.filter((g) => g.userId === u.id).map((g) => ({ moduleKey: g.moduleKey })),
  });
  const prisma: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        users.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => withAccess(users.find((u) => u.id === where.id) as FakeUser)),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        users.filter((u) => match(u, where)).map(withAccess)[0] ?? null),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        users.filter((u) => match(u, where)).map(withAccess)),
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        users.filter((u) => match(u, where)).length),
      create: jest.fn(async ({ data }: { data: Omit<FakeUser, 'id'> }) => {
        const user = { ...data, id: `user_${users.length + 1}` } as FakeUser;
        users.push(user);
        return withAccess(user);
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        const user = users.find((u) => u.id === where.id) as FakeUser;
        Object.assign(user, data);
        return withAccess(user);
      }),
    },
    organization: { findUnique: jest.fn(async () => ({ id: 'org_1', name: 'Loja', status: 'ACTIVE' })) },
    organizationModule: { findMany: jest.fn(async () => [long('overview'), long('products')]) },
    userModuleAccess: {
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) => grants.filter((g) => g.userId === where.userId)),
      deleteMany: jest.fn(async ({ where }: { where: { userId: string; moduleKey?: { in: string[] } } }) => {
        grants = grants.filter((g) => g.userId !== where.userId || (where.moduleKey ? !where.moduleKey.in.includes(g.moduleKey) : false));
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: { data: typeof grants }) => {
        grants.push(...data);
        return { count: data.length };
      }),
    },
    integration: { findMany: jest.fn(async () => [{ kind: 'COMMERCE', status: 'OK', config: {} }]) },
    syncState: { findUnique: jest.fn(async () => null) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown, _opts?: unknown) => fn(prisma));
  const app = await buildServer({
    config: testConfig, prisma: prisma as unknown as PrismaClient,
    gateway: {} as unknown as MetricGateway,
    pseudonymizer: new Pseudonymizer(testConfig.piiPepper),
    secretBox: new SecretBox(testConfig.credentialsEncryptionKey),
    queue: { enqueue: jest.fn(async () => {}) }, connectors: {} as never,
  });
  const login = await app.inject({
    method: 'POST', url: '/auth/login', payload: { email: 'ana@example.com', password: 'segredo123' },
  });
  const headers = { authorization: `Bearer ${login.json().token as string}` };
  return {
    app, headers, users, getGrants: () => grants,
    prisma: prisma as unknown as { $transaction: jest.Mock },
  };
}

const newUser = (extra: Record<string, unknown> = {}) => ({
  name: 'Caio', email: 'caio@example.com', role: 'MEMBER', temporaryPassword: 'senha-provisoria-1', modules: ['overview'], ...extra,
});

describe('users routes', () => {
  it('MEMBER gets 403', async () => {
    const ctx = await setup('MEMBER');
    const response = await ctx.app.inject({ method: 'GET', url: '/api/users', headers: ctx.headers });
    expect(response.statusCode).toBe(403);
    await ctx.app.close();
  });

  it('lists users of the organization only, admin with all visible modules', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/users', headers: ctx.headers });
    expect(response.statusCode).toBe(200);
    const list = response.json();
    expect(list.map((u: { id: string }) => u.id).sort()).toEqual(['user_1', 'user_2']);
    expect(list.find((u: { id: string }) => u.id === 'user_1').modules).toEqual(['overview', 'products']);
    expect(list.find((u: { id: string }) => u.id === 'user_2').modules).toEqual(['overview']);
    expect(JSON.stringify(list)).not.toContain('passwordHash');
    await ctx.app.close();
  });

  it('creates a user with mustChangePassword and grants', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({ method: 'POST', url: '/api/users', headers: ctx.headers, payload: newUser() });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'Caio', role: 'MEMBER', mustChangePassword: true, modules: ['overview'] });
    expect(ctx.getGrants()).toContainEqual({ userId: 'user_4', moduleKey: 'overview', grantedByUserId: 'user_1' });
    await ctx.app.close();
  });

  it('rejects a temporary password shorter than 12 characters', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/users', headers: ctx.headers, payload: newUser({ temporaryPassword: 'curta' }),
    });
    expect(response.statusCode).toBe(400);
    await ctx.app.close();
  });

  it('returns 404 for a user of another organization', async () => {
    const ctx = await setup();
    const patch = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_other', headers: ctx.headers, payload: { name: 'X' },
    });
    expect(patch.statusCode).toBe(404);
    expect(patch.json().error).toBe('not_found');
    const reset = await ctx.app.inject({
      method: 'POST', url: '/api/users/user_other/reset-password', headers: ctx.headers,
      payload: { temporaryPassword: 'senha-provisoria-1' },
    });
    expect(reset.statusCode).toBe(404);
    expect(ctx.users.find((u) => u.id === 'user_other')?.name).toBe('Zed');
    await ctx.app.close();
  });

  it('email used in another organization returns 409 without naming it', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/users', headers: ctx.headers, payload: newUser({ email: 'zed@other.com' }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'email_in_use', message: 'e-mail já cadastrado' });
    await ctx.app.close();
  });

  it('cannot grant a module the organization has not contracted', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/users', headers: ctx.headers, payload: newUser({ modules: ['sprint'] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'bad_request', message: 'módulo não contratado: sprint' });
    const invalid = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_2', headers: ctx.headers, payload: { modules: ['nope'] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(ctx.getGrants()).toEqual([{ userId: 'user_2', moduleKey: 'overview' }]);
    await ctx.app.close();
  });

  it('cannot deactivate self', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_1', headers: ctx.headers, payload: { active: false },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('cannot_deactivate_self');
    await ctx.app.close();
  });

  it('last admin cannot be demoted or deactivated', async () => {
    const ctx = await setup();
    const demote = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_1', headers: ctx.headers, payload: { role: 'MEMBER' },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error).toBe('last_admin');
    // Segundo Admin ativo: desativá-lo (sobra o primeiro) é permitido.
    ctx.users.push({ ...ctx.users[0]!, id: 'user_adm2', email: 'adm2@example.com' });
    const deactivateOther = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_adm2', headers: ctx.headers, payload: { active: false },
    });
    expect(deactivateOther.statusCode).toBe(200);
    // Agora o segundo está inativo, então user_1 volta a ser o último ativo.
    const demoteAgain = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_1', headers: ctx.headers, payload: { role: 'MEMBER' },
    });
    expect(demoteAgain.statusCode).toBe(409);
    expect(ctx.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    await ctx.app.close();
  });

  it('PATCH modules replaces the grant set', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_2', headers: ctx.headers, payload: { modules: ['products'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().modules).toEqual(['products']);
    expect(ctx.getGrants()).toEqual([{ userId: 'user_2', moduleKey: 'products', grantedByUserId: 'user_1' }]);
    await ctx.app.close();
  });

  it('a grant for a suspended module survives a PATCH of modules', async () => {
    const ctx = await setup();
    ctx.getGrants().push({ userId: 'user_2', moduleKey: 'sprint' });
    const response = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_2', headers: ctx.headers, payload: { modules: ['products'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().modules).toEqual(['products']);
    expect(ctx.getGrants().map((g) => g.moduleKey).sort()).toEqual(['products', 'sprint']);
    await ctx.app.close();
  });

  it('GET hides grants of suspended modules', async () => {
    const ctx = await setup();
    ctx.getGrants().push({ userId: 'user_2', moduleKey: 'sprint' });
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/users', headers: ctx.headers })).json();
    expect(list.find((u: { id: string }) => u.id === 'user_2').modules).toEqual(['overview']);
    await ctx.app.close();
  });

  it('retries a serialization conflict and then returns 409 last_admin', async () => {
    const ctx = await setup();
    const real = ctx.prisma.$transaction.getMockImplementation() as (fn: unknown, o?: unknown) => Promise<unknown>;
    let calls = 0;
    ctx.prisma.$transaction.mockImplementation(async (fn: unknown, o?: unknown) => {
      calls += 1;
      if (calls === 1) {
        throw new Prisma.PrismaClientKnownRequestError('conflito', { code: 'P2034', clientVersion: 'test' });
      }
      return real(fn, o);
    });
    const response = await ctx.app.inject({
      method: 'PATCH', url: '/api/users/user_1', headers: ctx.headers, payload: { role: 'MEMBER' },
    });
    expect(calls).toBe(2);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('last_admin');
    await ctx.app.close();
  });

  it('reset-password sets mustChangePassword', async () => {
    const ctx = await setup();
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/users/user_2/reset-password', headers: ctx.headers,
      payload: { temporaryPassword: 'senha-provisoria-1' },
    });
    expect(response.statusCode).toBe(204);
    const user = ctx.users.find((u) => u.id === 'user_2')!;
    expect(user.mustChangePassword).toBe(true);
    expect(user.passwordHash).not.toContain('senha-provisoria-1');
    expect(user.passwordChangedAt).toBeInstanceOf(Date);
    await ctx.app.close();
  });

  it('reset-password by the Admin ends the user\'s open sessions (old token → 401)', async () => {
    const ctx = await setup();
    const login = await ctx.app.inject({
      method: 'POST', url: '/auth/login', payload: { email: 'bia@example.com', password: 'segredo123' },
    });
    const biaHeaders = { authorization: `Bearer ${login.json().token as string}` };
    expect((await ctx.app.inject({ method: 'GET', url: '/auth/me', headers: biaHeaders })).statusCode).toBe(200);

    const reset = await ctx.app.inject({
      method: 'POST', url: '/api/users/user_2/reset-password', headers: ctx.headers,
      payload: { temporaryPassword: 'senha-provisoria-1' },
    });
    expect(reset.statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/auth/me', headers: biaHeaders })).statusCode).toBe(401);
    // A sessão de quem redefiniu continua valendo.
    expect((await ctx.app.inject({ method: 'GET', url: '/api/users', headers: ctx.headers })).statusCode).toBe(200);
    await ctx.app.close();
  });
});

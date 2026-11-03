import type { PrismaClient } from '@prisma/client';
import type { MetricGateway } from '@center/mcp-core';
import { Pseudonymizer } from '@center/pii';
import { SecretBox } from '@center/secrets';
import { buildServer } from '../server.js';
import { testConfig } from './helpers/config.js';

import { bearer, operatorToken } from './helpers/operator.js';

const now = new Date('2026-11-01T00:00:00Z');
const past = new Date('2026-01-01T00:00:00Z');

async function setup(overrides: Record<string, unknown> = {}) {
  const auditCreate = jest.fn(async () => ({}));
  const orgs = [
    {
      id: 'org_1', name: 'Loja A', slug: 'loja-a', status: 'ACTIVE', createdAt: now,
      modules: [
        { moduleKey: 'overview', status: 'ACTIVE', startsAt: past, endsAt: null },
        { moduleKey: 'acquisition', status: 'ACTIVE', startsAt: past, endsAt: null },
        { moduleKey: 'sprint', status: 'SUSPENDED', startsAt: past, endsAt: null },
      ],
      _count: { users: 3 },
    },
  ];
  const moduleUpsert = jest.fn(async (args: { create: Record<string, unknown> }) => ({ ...args.create }));
  const prisma = {
    platformOperator: {
      findUnique: jest.fn(async () => ({ id: 'op_1', email: 'op@blan.com', name: 'Operador', active: true })),
    },
    operatorAuditLog: { create: auditCreate },
    organization: {
      findMany: jest.fn(async () => orgs),
      findUnique: jest.fn(async (args: { where: { id?: string; slug?: string } }) =>
        orgs.find((o) => o.id === args.where.id || o.slug === args.where.slug) ?? null),
      create: jest.fn(async (args: { data: { name: string; slug: string } }) => ({
        id: 'org_new', ...args.data, status: 'ACTIVE', createdAt: now, modules: [], _count: { users: 0 },
      })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ ...orgs[0], ...args.data })),
    },
    integration: { findMany: jest.fn(async () => []) },
    organizationModule: {
      findUnique: jest.fn(async () => null),
      upsert: moduleUpsert,
    },
    ...overrides,
  } as unknown as PrismaClient;
  const app = await buildServer({
    config: testConfig, prisma,
    gateway: { listMetrics: jest.fn(async () => []) } as unknown as MetricGateway,
    pseudonymizer: new Pseudonymizer(testConfig.piiPepper),
    secretBox: new SecretBox(testConfig.credentialsEncryptionKey), queue: { enqueue: jest.fn(async () => {}) },
  });
  return { app, prisma, auditCreate, moduleUpsert };
}

describe('internal organizations', () => {
  it('lists organizations with pendingSetup for in-force modules awaiting setup', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/internal/organizations', headers: bearer(operatorToken()) });
    expect(res.statusCode).toBe(200);
    const [org] = res.json();
    expect(org.slug).toBe('loja-a');
    expect(org.modules.map((m: { key: string; inForce: boolean }) => [m.key, m.inForce]))
      .toEqual([['overview', true], ['acquisition', true], ['sprint', false]]);
    // sem integrações: os módulos em vigor aguardam configuração; o suspenso não conta
    expect(org.pendingSetup).toEqual(expect.arrayContaining(['overview', 'acquisition']));
    expect(org.pendingSetup).not.toContain('sprint');
    await app.close();
  });

  it('returns detail with usersCount and attribution', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/internal/organizations/org_1', headers: bearer(operatorToken()) });
    expect(res.statusCode).toBe(200);
    expect(res.json().usersCount).toBe(3);
    expect(res.json().attribution).toEqual({ organizationId: 'org_1', apiUrl: testConfig.panelOrigin });
    const missing = await app.inject({ method: 'GET', url: '/internal/organizations/nope', headers: bearer(operatorToken()) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('not_found');
    await app.close();
  });

  it('creates with a slug derived from the name and 409 on duplicate', async () => {
    const { app, prisma, auditCreate } = await setup();
    const ok = await app.inject({
      method: 'POST', url: '/internal/organizations', headers: bearer(operatorToken()), payload: { name: 'Loja Nova Ação' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().slug).toBe('loja-nova-acao');
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'organization.create', organizationId: 'org_new' }),
    }));
    const dup = await app.inject({
      method: 'POST', url: '/internal/organizations', headers: bearer(operatorToken()), payload: { name: 'Outra', slug: 'loja-a' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe('slug_in_use');
    // corrida: a unicidade do banco também vira 409
    (prisma.organization.create as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'P2002' }));
    const race = await app.inject({
      method: 'POST', url: '/internal/organizations', headers: bearer(operatorToken()), payload: { name: 'Corrida' },
    });
    expect(race.statusCode).toBe(409);
    expect(race.json().error).toBe('slug_in_use');
    await app.close();
  });

  it('unknown module key → 404', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/modules/bogus', headers: bearer(operatorToken()),
      payload: { status: 'ACTIVE' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('endsAt before startsAt → 400', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/modules/overview', headers: bearer(operatorToken()),
      payload: { status: 'ACTIVE', startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-05-01T00:00:00Z' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('module upsert writes updatedByOperatorId and an audit row with organizationId', async () => {
    const { app, moduleUpsert, auditCreate } = await setup();
    const res = await app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/modules/products', headers: bearer(operatorToken()),
      payload: { status: 'ACTIVE', startsAt: '2026-06-01T00:00:00Z', endsAt: null },
    });
    expect(res.statusCode).toBe(200);
    expect(moduleUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ organizationId: 'org_1', moduleKey: 'products', updatedByOperatorId: 'op_1', origin: 'MANUAL' }),
      update: expect.objectContaining({ updatedByOperatorId: 'op_1' }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'module.activate', organizationId: 'org_1', operatorId: 'op_1' }),
    }));
    await app.close();
  });

  it('creating a module as SUSPENDED audits module.suspend', async () => {
    const { app, auditCreate } = await setup();
    const res = await app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/modules/products', headers: bearer(operatorToken()),
      payload: { status: 'SUSPENDED' },
    });
    expect(res.statusCode).toBe(200);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'module.suspend', organizationId: 'org_1' }),
    }));
    await app.close();
  });

  it('module update and suspend pick the right audit action', async () => {
    const existing = { status: 'ACTIVE', startsAt: past, endsAt: null };
    const { app, auditCreate } = await setup({
      organizationModule: {
        findUnique: jest.fn(async () => existing),
        upsert: jest.fn(async (args: { create: Record<string, unknown> }) => args.create),
      },
    });
    await app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/modules/overview', headers: bearer(operatorToken()),
      payload: { status: 'ACTIVE', endsAt: '2027-01-01T00:00:00Z' },
    });
    await app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/modules/overview', headers: bearer(operatorToken()),
      payload: { status: 'SUSPENDED' },
    });
    const actions = auditCreate.mock.calls.map((c) => (c as unknown as [{ data: { action: string } }])[0].data.action);
    expect(actions).toEqual(['module.update', 'module.suspend']);
    await app.close();
  });

  it('suspend writes organization.suspend', async () => {
    const { app, auditCreate } = await setup();
    const res = await app.inject({
      method: 'PATCH', url: '/internal/organizations/org_1', headers: bearer(operatorToken()), payload: { status: 'SUSPENDED' },
    });
    expect(res.statusCode).toBe(200);
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'organization.suspend', organizationId: 'org_1' }),
    }));
    await app.close();
  });

  it('client token gets 401 on every route here', async () => {
    const { app } = await setup();
    const token = app.jwt.sign({ userId: 'user_1', organizationId: 'org_1', role: 'ADMIN' });
    const routes: Array<[string, string, object?]> = [
      ['GET', '/internal/organizations'],
      ['POST', '/internal/organizations', { name: 'x' }],
      ['GET', '/internal/organizations/org_1'],
      ['PATCH', '/internal/organizations/org_1', { name: 'y' }],
      ['PUT', '/internal/organizations/org_1/modules/overview', { status: 'ACTIVE' }],
    ];
    for (const [method, url, payload] of routes) {
      const res = await app.inject({ method: method as 'GET', url, headers: bearer(token), payload });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });
});

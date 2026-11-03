import type { PrismaClient } from '@prisma/client';
import type { MetricGateway } from '@center/mcp-core';
import { Pseudonymizer } from '@center/pii';
import { SecretBox } from '@center/secrets';
import { buildServer } from '../server.js';
import { hashPassword } from '../auth/password.js';
import { testConfig } from './helpers/config.js';

const NOT_AVAILABLE = { error: 'module_not_available', message: 'módulo não disponível para este usuário' };
const PENDING = { error: 'integration_pending', message: 'integração ainda não configurada pela equipe Blan' };

interface Contract { moduleKey: string; status: 'ACTIVE' | 'SUSPENDED'; startsAt: Date; endsAt: Date | null }
const long = (moduleKey: string, extra: Partial<Contract> = {}): Contract => ({
  moduleKey, status: 'ACTIVE', startsAt: new Date('2020-01-01'), endsAt: null, ...extra,
});

interface Options {
  role?: 'ADMIN' | 'MEMBER';
  contracts: Contract[];
  grants?: string[];
  failAccess?: boolean;
  integrations?: Array<{ kind: string; status: string; config: unknown }>;
}

async function setup(options: Options) {
  let loginDone = false;
  const state = { contracts: options.contracts };
  const gateway = {
    listMetrics: jest.fn(async () => []),
    queryMetric: jest.fn(async () => ({ metricId: 'x', points: [] })),
    queryBatch: jest.fn(async () => [{ points: [] }, { points: [] }]),
    callTool: jest.fn(async () => ({ rows: [] })),
  } as unknown as MetricGateway;
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        id: 'user_1', email: 'ana@example.com', name: 'Ana', role: options.role ?? 'ADMIN',
        organizationId: 'org_1', passwordHash: await hashPassword('segredo123'),
        active: true, mustChangePassword: false,
      })),
    },
    organization: { findUnique: jest.fn(async () => ({ id: 'org_1', name: 'Loja', status: 'ACTIVE' })) },
    organizationModule: {
      findMany: jest.fn(async () => {
        if (options.failAccess && loginDone) throw new Error('boom-internal');
        return state.contracts;
      }),
    },
    userModuleAccess: { findMany: jest.fn(async () => (options.grants ?? []).map((moduleKey) => ({ moduleKey }))) },
    integration: {
      findMany: jest.fn(async () => options.integrations ?? [
        { kind: 'COMMERCE', status: 'OK', config: {} },
        { kind: 'WEB_ANALYTICS', status: 'OK', config: { bigQueryDataset: 'ds' } },
        { kind: 'APP_ANALYTICS', status: 'OK', config: {} },
      ]),
    },
  } as unknown as PrismaClient;
  const app = await buildServer({
    config: testConfig, prisma, gateway,
    pseudonymizer: new Pseudonymizer(testConfig.piiPepper),
    secretBox: new SecretBox(testConfig.credentialsEncryptionKey),
    queue: { enqueue: jest.fn(async () => {}) }, connectors: {} as never,
  });
  const login = await app.inject({
    method: 'POST', url: '/auth/login', payload: { email: 'ana@example.com', password: 'segredo123' },
  });
  loginDone = true;
  const headers = { authorization: `Bearer ${login.json().token as string}` };
  return { app, gateway: gateway as unknown as Record<string, jest.Mock>, headers, state };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
const range = { from: '2026-01-01', to: '2026-01-31', granularity: 'day' };
const tool = (ctx: Ctx, source = 'commerce', name = 'top_products') =>
  ctx.app.inject({
    method: 'POST', url: `/api/tools/${source}/${name}`, headers: ctx.headers,
    payload: { from: '2026-01-01', to: '2026-01-31' },
  });

describe('module access', () => {
  it('member without the products grant gets 403 on a commerce tool although products is contracted', async () => {
    const ctx = await setup({ role: 'MEMBER', contracts: [long('products')], grants: [] });
    const response = await tool(ctx);
    expect(response.statusCode).toBe(403);
    expect(ctx.gateway.callTool).not.toHaveBeenCalled();
    await ctx.app.close();
  });

  it('403 body is identical for not-contracted and not-granted', async () => {
    const notContracted = await setup({ role: 'ADMIN', contracts: [] });
    const a = await tool(notContracted);
    const notGranted = await setup({ role: 'MEMBER', contracts: [long('products')], grants: [] });
    const b = await tool(notGranted);
    expect(a.statusCode).toBe(403);
    expect(a.json()).toEqual(NOT_AVAILABLE);
    expect(b.json()).toEqual(a.json());
    await notContracted.app.close();
    await notGranted.app.close();
  });

  it('module past endsAt is absent from /auth/me and its source is 403', async () => {
    const ctx = await setup({
      contracts: [long('overview'), long('app_usage', { endsAt: new Date('2021-01-01') })],
    });
    const me = (await ctx.app.inject({ method: 'GET', url: '/auth/me', headers: ctx.headers })).json();
    expect(me.modules.map((m: { key: string }) => m.key)).toEqual(['overview']);
    expect(me.sources).not.toContain('firebase');
    expect((await tool(ctx, 'firebase', 'usage_summary')).statusCode).toBe(403);
    await ctx.app.close();
  });

  it('contracted acquisition without WEB_ANALYTICS returns 409 integration_pending on a ga4 query', async () => {
    const ctx = await setup({
      contracts: [long('acquisition')],
      integrations: [{ kind: 'COMMERCE', status: 'OK', config: {} }],
    });
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/metrics/query', headers: ctx.headers,
      payload: { metricId: 'ga4.sessions', ...range },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(PENDING);
    expect(ctx.gateway.queryMetric).not.toHaveBeenCalled();
    await ctx.app.close();
  });

  it('suspending a module takes effect on the next request with the same token', async () => {
    const ctx = await setup({ contracts: [long('products')] });
    expect((await tool(ctx)).statusCode).toBe(200);
    ctx.state.contracts = [long('products', { status: 'SUSPENDED' })];
    expect((await tool(ctx)).statusCode).toBe(403);
    await ctx.app.close();
  });

  it('batch with one forbidden source returns 403 and calls the gateway zero times', async () => {
    const ctx = await setup({ contracts: [long('products')] });
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/metrics/batch', headers: ctx.headers,
      payload: { queries: [
        { metricId: 'commerce.revenue', ...range },
        { metricId: 'ga4.sessions', ...range },
      ] },
    });
    expect(response.statusCode).toBe(403);
    expect(ctx.gateway.queryBatch).not.toHaveBeenCalled();
    await ctx.app.close();
  });

  it('correlate commerce×ga4 needs both sources', async () => {
    const body = { metricIdA: 'commerce.revenue', metricIdB: 'ga4.sessions', ...range };
    const onlyCommerce = await setup({ contracts: [long('products')] });
    const denied = await onlyCommerce.app.inject({
      method: 'POST', url: '/api/analysis/correlate', headers: onlyCommerce.headers, payload: body,
    });
    expect(denied.statusCode).toBe(403);
    expect(onlyCommerce.gateway.queryBatch).not.toHaveBeenCalled();

    const both = await setup({ contracts: [long('products'), long('acquisition')] });
    const ok = await both.app.inject({
      method: 'POST', url: '/api/analysis/correlate', headers: both.headers, payload: body,
    });
    expect([403, 409]).not.toContain(ok.statusCode);
    await onlyCommerce.app.close();
    await both.app.close();
  });

  it('app-version-impact needs app_usage', async () => {
    const ctx = await setup({ contracts: [long('products')] });
    const response = await ctx.app.inject({
      method: 'POST', url: '/api/analysis/app-version-impact', headers: ctx.headers,
      payload: { version: '1.0.0', releaseDate: '2026-01-10' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual(NOT_AVAILABLE);
    await ctx.app.close();
  });

  it('/auth/me lists modules with state and the sources array', async () => {
    const ctx = await setup({
      contracts: [long('overview'), long('acquisition')],
      integrations: [{ kind: 'COMMERCE', status: 'OK', config: {} }],
    });
    const me = (await ctx.app.inject({ method: 'GET', url: '/auth/me', headers: ctx.headers })).json();
    expect(me.user).toEqual({
      id: 'user_1', name: 'Ana', email: 'ana@example.com', role: 'ADMIN', mustChangePassword: false,
    });
    expect(me.organization).toEqual({ id: 'org_1', name: 'Loja' });
    expect(me.viewSession).toBe(false);
    expect(me.modules).toEqual([
      { key: 'overview', label: 'Visão geral', menuPath: '/', state: 'ready' },
      { key: 'acquisition', label: 'Aquisição', menuPath: '/aquisicao', state: 'awaiting_setup' },
    ]);
    expect([...me.sources].sort()).toEqual(['behavior', 'commerce', 'ga4']);
    await ctx.app.close();
  });
});

describe('module access (analysis fixes)', () => {
  const impact = (ctx: Ctx) => ctx.app.inject({
    method: 'POST', url: '/api/analysis/app-version-impact', headers: ctx.headers,
    payload: { version: '1.0.0', releaseDate: '2026-01-10' },
  });

  it('app-version-impact with only app_usage (no commerce/ga4 sources) → 403 and the gateway is not called', async () => {
    const ctx = await setup({ contracts: [long('app_usage')] });
    const response = await impact(ctx);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual(NOT_AVAILABLE);
    expect(ctx.gateway.queryBatch).not.toHaveBeenCalled();
    expect(ctx.gateway.callTool).not.toHaveBeenCalled();
    await ctx.app.close();
  });

  it('app-version-impact with app_usage + products + acquisition → passes authorization', async () => {
    const ctx = await setup({ contracts: [long('app_usage'), long('products'), long('acquisition')] });
    const response = await impact(ctx);
    expect([403, 409]).not.toContain(response.statusCode);
    await ctx.app.close();
  });

  it('correlate with a failing access load does not return 400 with the internal message', async () => {
    const failing = await setup({ contracts: [long('products')], failAccess: true });
    const response = await failing.app.inject({
      method: 'POST', url: '/api/analysis/correlate', headers: failing.headers,
      payload: { metricIdA: 'commerce.revenue', metricIdB: 'commerce.orders', ...range },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('boom-internal');
    await failing.app.close();
  });
});

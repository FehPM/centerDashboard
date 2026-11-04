import { internalApp } from './helpers/internal-app.js';
import { bearer, operatorToken } from './helpers/operator.js';

type AuditCalls = Array<[{ data: Record<string, unknown> }]>;

async function setup() {
  const parts = {
    organization: {
      findUnique: jest.fn(async (a: { where: { id: string } }) =>
        a.where.id === 'org_1' ? { id: 'org_1', name: 'Loja', status: 'ACTIVE' } : null),
    },
    integration: { findMany: jest.fn(async () => []) },
    organizationModule: { findMany: jest.fn(async () => []) },
    userModuleAccess: { findMany: jest.fn(async () => []) },
    syncState: { findUnique: jest.fn(async () => null) },
  };
  const ctx = await internalApp(parts);
  const res = await ctx.app.inject({
    method: 'POST', url: '/internal/organizations/org_1/view-session', headers: bearer(operatorToken()),
  });
  return { ...ctx, res, body: res.json() as { token: string; url: string; expiresAt: string } };
}

describe('internal view session', () => {
  it('token works on /api/metrics/catalog', async () => {
    const { app, res, body } = await setup();
    expect(res.statusCode).toBe(200);
    expect(body.url).toBe(`http://localhost:5173/view-session#${body.token}`);
    const catalog = await app.inject({ method: 'GET', url: '/api/metrics/catalog', headers: bearer(body.token) });
    expect(catalog.statusCode).toBe(200);
    await app.close();
  });

  it('token gets 403 readonly_session on POST /api/users and POST /api/agent/ask', async () => {
    const { app, body } = await setup();
    for (const url of ['/api/users', '/api/agent/ask']) {
      const r = await app.inject({ method: 'POST', url, headers: bearer(body.token), payload: {} });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe('readonly_session');
    }
    await app.close();
  });

  it('/auth/me returns viewSession: true and the Blan display name', async () => {
    const { app, body } = await setup();
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: bearer(body.token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().viewSession).toBe(true);
    expect(me.json().user.name).toBe('Equipe Blan (visualização)');
    await app.close();
  });

  it('expires in 30 minutes', async () => {
    const { app, body } = await setup();
    const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString()) as
      { exp: number; iat: number; viewedBy: string; userId: string; role: string; organizationId: string; aud: string };
    expect(payload.exp - payload.iat).toBe(1800);
    expect(payload).toMatchObject({
      userId: 'operator:op_1', viewedBy: 'op_1', role: 'ADMIN', organizationId: 'org_1', aud: 'client',
    });
    expect(Math.abs(Date.parse(body.expiresAt) - payload.exp * 1000)).toBeLessThan(2000);
    await app.close();
  });

  it('unknown organization → 404', async () => {
    const { app } = await setup();
    const r = await app.inject({
      method: 'POST', url: '/internal/organizations/nope/view-session', headers: bearer(operatorToken()),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe('not_found');
    await app.close();
  });

  it('writes view_session.start with the organizationId', async () => {
    const { app, auditCreate } = await setup();
    expect((auditCreate.mock.calls as unknown as AuditCalls)[0][0].data)
      .toMatchObject({ action: 'view_session.start', organizationId: 'org_1', operatorId: 'op_1' });
    await app.close();
  });
});

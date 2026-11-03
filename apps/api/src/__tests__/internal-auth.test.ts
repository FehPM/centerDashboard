import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { MetricGateway } from '@center/mcp-core';
import { Pseudonymizer } from '@center/pii';
import { SecretBox } from '@center/secrets';
import { authenticator } from 'otplib';
import { buildServer } from '../server.js';
import { hashPassword } from '../auth/password.js';
import { testConfig } from './helpers/config.js';

async function setup(config: typeof testConfig = testConfig) {
  const operatorRow = {
    id: 'op_1', email: 'op@blan.com', name: 'Operador', passwordHash: await hashPassword('senha-longa-123'),
    totpSecret: null as string | null, totpEnabledAt: null as Date | null, active: true, lastLoginAt: null as Date | null,
    failedTotpAttempts: 0, totpLockedUntil: null as Date | null,
  };
  const auditCreate = jest.fn(async () => ({}));
  const prisma = {
    platformOperator: {
      findUnique: jest.fn(async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email && args.where.email !== operatorRow.email) return null;
        if (args.where.id && args.where.id !== operatorRow.id) return null;
        return operatorRow;
      }),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        for (const [key, value] of Object.entries(args.data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            (operatorRow as Record<string, unknown>)[key] = (operatorRow as unknown as Record<string, number>)[key]! + (value as { increment: number }).increment;
          } else {
            (operatorRow as Record<string, unknown>)[key] = value;
          }
        }
        return operatorRow;
      }),
    },
    operatorAuditLog: { create: auditCreate },
    user: {
      findUnique: jest.fn(async () => ({
        active: true, role: 'ADMIN', mustChangePassword: false, organizationId: 'org_1',
      })),
    },
    organization: { findUnique: jest.fn(async () => ({ id: 'org_1', name: 'Loja', status: 'ACTIVE' })) },
    integration: { findMany: jest.fn(async () => []) },
    organizationModule: { findMany: jest.fn(async () => []) },
    userModuleAccess: { findMany: jest.fn(async () => []) },
    syncState: { findUnique: jest.fn(async () => null) },
  } as unknown as PrismaClient;
  const secretBox = new SecretBox(testConfig.credentialsEncryptionKey);
  const app = await buildServer({
    config, prisma,
    gateway: { listMetrics: jest.fn(async () => []) } as unknown as MetricGateway,
    pseudonymizer: new Pseudonymizer(testConfig.piiPepper),
    secretBox, queue: { enqueue: jest.fn(async () => {}) }, connectors: {} as never,
  });
  return { app, operatorRow, auditCreate, secretBox, prisma };
}

type App = Awaited<ReturnType<typeof setup>>['app'];
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const login = (app: App, password = 'senha-longa-123', email = 'op@blan.com') =>
  app.inject({ method: 'POST', url: '/internal/auth/login', payload: { email, password } });
const totp = (app: App, token: string, code: string) =>
  app.inject({ method: 'POST', url: '/internal/auth/totp', payload: { token, code } });

async function fullSession(app: App) {
  const first = (await login(app)).json();
  const done = await totp(app, first.token, authenticator.generate(first.secret));
  return { secret: first.secret as string, session: done.json().token as string };
}

describe('operator auth', () => {
  it('client token is rejected on /internal/auth/me with 401', async () => {
    const { app } = await setup();
    const token = app.jwt.sign({ userId: 'user_1', organizationId: 'org_1', role: 'ADMIN' });
    const res = await app.inject({ method: 'GET', url: '/internal/auth/me', headers: bearer(token) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('operator session token is rejected on /api/metrics/catalog with 401', async () => {
    const { app } = await setup();
    const { session } = await fullSession(app);
    const res = await app.inject({ method: 'GET', url: '/api/metrics/catalog', headers: bearer(session) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('operator token without aud is rejected on /internal/auth/me', async () => {
    const { app } = await setup();
    // HS256 manual, com o segredo certo mas sem claim `aud`.
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ operatorId: 'op_1', stage: 'session' })}`;
    const signature = createHmac('sha256', testConfig.operatorJwtSecret).update(unsigned).digest('base64url');
    const token = `${unsigned}.${signature}`;
    const res = await app.inject({ method: 'GET', url: '/internal/auth/me', headers: bearer(token) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('mfa-stage token cannot call /internal/auth/me', async () => {
    const { app } = await setup();
    const { session } = await fullSession(app);
    void session;
    const second = (await login(app)).json();
    expect(second.stage).toBe('mfa');
    const res = await app.inject({ method: 'GET', url: '/internal/auth/me', headers: bearer(second.token) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('session token cannot be used as a challenge token on /internal/auth/totp', async () => {
    const { app } = await setup();
    const { session, secret } = await fullSession(app);
    const res = await totp(app, session, authenticator.generate(secret));
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('first login returns enroll; wrong code keeps TOTP disabled; right code enables it and returns a session', async () => {
    const { app, operatorRow, auditCreate, secretBox } = await setup();
    const first = await login(app);
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.stage).toBe('enroll');
    expect(body.otpauthUri).toContain('Center%20Back-office');
    // Segredo gravado cifrado, nunca em claro.
    expect(operatorRow.totpSecret).not.toBe(body.secret);
    expect(secretBox.decrypt(operatorRow.totpSecret as string)).toBe(body.secret);

    const wrong = await totp(app, body.token, authenticator.generate(body.secret) === '000000' ? '111111' : '000000');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toBe('unauthorized');
    expect(operatorRow.totpEnabledAt).toBeNull();

    const right = await totp(app, body.token, authenticator.generate(body.secret));
    expect(right.statusCode).toBe(200);
    expect(operatorRow.totpEnabledAt).toBeInstanceOf(Date);
    expect(right.json().operator).toEqual({ id: 'op_1', name: 'Operador', email: 'op@blan.com' });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'operator.login', operatorId: 'op_1' }),
    }));
    const me = await app.inject({ method: 'GET', url: '/internal/auth/me', headers: bearer(right.json().token) });
    expect(me.statusCode).toBe(200);
    await app.close();
  });

  it('second login returns mfa and accepts a valid code', async () => {
    const { app } = await setup();
    const { secret } = await fullSession(app);
    const second = (await login(app)).json();
    expect(second).toEqual({ stage: 'mfa', token: expect.any(String) });
    const res = await totp(app, second.token, authenticator.generate(secret));
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toEqual(expect.any(String));
    await app.close();
  });

  it('inactive operator gets the same 401 body as a wrong password', async () => {
    const { app, operatorRow } = await setup();
    const wrong = await login(app, 'senha-errada-123');
    const unknown = await login(app, 'senha-longa-123', 'nobody@blan.com');
    operatorRow.active = false;
    const inactive = await login(app);
    expect(wrong.statusCode).toBe(401);
    expect(inactive.statusCode).toBe(401);
    expect(inactive.body).toBe(wrong.body);
    expect(unknown.body).toBe(wrong.body);
    await app.close();
  });

  it('session token expires in 8h', async () => {
    const { app } = await setup();
    const { session } = await fullSession(app);
    const decoded = app.jwt.decode<{ exp: number; iat: number }>(session);
    expect(decoded!.exp - decoded!.iat).toBe(28800);
    await app.close();
  });

  const wrongCode = (secret: string) => (authenticator.generate(secret) === '000000' ? '111111' : '000000');

  it('locks the operator after 5 wrong codes and refuses even a valid code while locked (429)', async () => {
    const { app, operatorRow } = await setup();
    const { secret } = await fullSession(app);
    const mfa = (await login(app)).json();
    for (let i = 0; i < 5; i += 1) {
      expect((await totp(app, mfa.token, wrongCode(secret))).statusCode).toBe(401);
    }
    expect(operatorRow.totpLockedUntil).toBeInstanceOf(Date);
    expect(operatorRow.failedTotpAttempts).toBe(0);
    const locked = await totp(app, mfa.token, authenticator.generate(secret));
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('too_many_attempts');
    await app.close();
  });

  it('a correct code resets the failure counter', async () => {
    const { app, operatorRow } = await setup();
    const { secret } = await fullSession(app);
    const mfa = (await login(app)).json();
    for (let i = 0; i < 3; i += 1) await totp(app, mfa.token, wrongCode(secret));
    expect(operatorRow.failedTotpAttempts).toBe(3);
    expect((await totp(app, mfa.token, authenticator.generate(secret))).statusCode).toBe(200);
    expect(operatorRow.failedTotpAttempts).toBe(0);
    expect(operatorRow.totpLockedUntil).toBeNull();
    await app.close();
  });

  it('lock expires after 15 minutes', async () => {
    const { app, operatorRow } = await setup();
    const { secret } = await fullSession(app);
    const mfa = (await login(app)).json();
    for (let i = 0; i < 5; i += 1) await totp(app, mfa.token, wrongCode(secret));
    const lockMs = operatorRow.totpLockedUntil!.getTime() - Date.now();
    expect(lockMs).toBeGreaterThan(14 * 60_000);
    expect(lockMs).toBeLessThanOrEqual(15 * 60_000);
    // Simula o relógio avançando 15 min: o bloqueio passa para o passado.
    operatorRow.totpLockedUntil = new Date(Date.now() - 1000);
    expect((await totp(app, mfa.token, authenticator.generate(secret))).statusCode).toBe(200);
    await app.close();
  });

  it('an enroll token stops working once TOTP is enabled', async () => {
    const { app } = await setup();
    const first = (await login(app)).json();
    expect((await totp(app, first.token, authenticator.generate(first.secret))).statusCode).toBe(200);
    expect((await totp(app, first.token, authenticator.generate(first.secret))).statusCode).toBe(401);
    await app.close();
  });

  it('/internal/auth/totp rejects a challenge token without aud', async () => {
    const { app } = await setup();
    const first = (await login(app)).json();
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ operatorId: 'op_1', stage: 'enroll' })}`;
    const token = `${unsigned}.${createHmac('sha256', testConfig.operatorJwtSecret).update(unsigned).digest('base64url')}`;
    expect((await totp(app, token, authenticator.generate(first.secret))).statusCode).toBe(401);
    await app.close();
  });

  it('rejects a code that is not 6 digits with 400', async () => {
    const { app } = await setup();
    const first = (await login(app)).json();
    expect((await totp(app, first.token, 'abcdef')).statusCode).toBe(400);
    await app.close();
  });

  it('with trustProxyHops 0 a forged X-Forwarded-For does not change request.ip', async () => {
    const { app } = await setup({ ...testConfig, trustProxyHops: 0 });
    app.get('/__ip', async (request) => ({ ip: request.ip }));
    const res = await app.inject({ method: 'GET', url: '/__ip', headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(res.json().ip).toBe('127.0.0.1');
    await app.close();
  });
});

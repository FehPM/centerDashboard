import { internalApp } from './helpers/internal-app.js';
import { bearer, operatorToken } from './helpers/operator.js';
import { decryptSecrets, encryptSecrets } from '../integrations/repository.js';
import { SecretBox } from '@center/secrets';
import { testConfig } from './helpers/config.js';

const headers = () => bearer(operatorToken());

const row = (kind: string, extra: Record<string, unknown> = {}) => ({
  kind, provider: 'GA4', config: {}, status: 'OK', lastCheckAt: null, lastError: null,
  secrets: null, secretsUpdatedAt: null, ...extra,
});

function integrationFake(existing: Record<string, unknown> | null = null) {
  const upsert = jest.fn(async (args: { create: Record<string, unknown> }) => ({
    config: {}, lastCheckAt: null, lastError: null, secretsUpdatedAt: null, secrets: null, ...args.create,
  }));
  return {
    upsert,
    integration: {
      findUnique: jest.fn(async () => existing),
      findMany: jest.fn(async () => [] as unknown[]),
      upsert,
      update: jest.fn(),
    },
    syncState: { findFirst: jest.fn(async () => ({ lastSyncedAt: new Date('2026-11-01T00:00:00Z'), lastError: null })) },
  };
}

const commerceBody = {
  provider: 'UAPPI', config: {}, secrets: { apiKey: 'demo-key-123', secretKey: 'demo-secret-456' },
};
const putCommerce = (payload: unknown) => ({
  method: 'PUT' as const, url: '/internal/organizations/org_1/integrations/COMMERCE', headers: headers(), payload: payload as object,
});

describe('internal integrations', () => {
  it('response never contains decrypted or encrypted secrets', async () => {
    const fake = integrationFake();
    const { app } = await internalApp(fake);
    const res = await app.inject(putCommerce(commerceBody));
    expect(res.statusCode).toBe(200);
    const text = JSON.stringify(res.json());
    for (const forbidden of ['demo-key-123', 'demo-secret-456', 'v1:', 'v1.']) expect(text).not.toContain(forbidden);
    expect(res.json().secretsConfigured).toBe(true);
    // o upsert recebeu o texto cifrado, não o claro
    const stored = fake.upsert.mock.calls[0][0].create.secrets as string;
    expect(stored).toMatch(/^v1[.:]/);
    expect(stored).not.toContain('demo-key-123');
    await app.close();
  });

  it('PUT without secrets keeps the existing ciphertext', async () => {
    const cipher = encryptSecrets(new SecretBox(testConfig.credentialsEncryptionKey), { apiKey: 'a', secretKey: 'b' });
    const fake = integrationFake({ secrets: cipher });
    const { app, connector } = await internalApp(fake);
    const res = await app.inject(putCommerce({ provider: 'UAPPI', config: {} }));
    expect(res.statusCode).toBe(200);
    const args = fake.upsert.mock.calls[0][0] as unknown as { update: Record<string, unknown> };
    expect(args.update).not.toHaveProperty('secrets');
    expect(args.update).not.toHaveProperty('secretsUpdatedAt');
    expect((connector.parseSettings as jest.Mock).mock.calls[0][1]).toEqual({ apiKey: 'a', secretKey: 'b' });
    await app.close();
  });

  it('COMMERCE check failure stores ERROR and lastError', async () => {
    const fake = integrationFake();
    const { app } = await internalApp(fake, {
      connector: { check: jest.fn(async () => ({ ok: false as const, error: 'credenciais recusadas' })) },
    });
    const res = await app.inject(putCommerce(commerceBody));
    expect(res.statusCode).toBe(200);
    const create = fake.upsert.mock.calls[0][0].create;
    expect(create).toMatchObject({ status: 'ERROR', lastError: 'credenciais recusadas' });
    expect(create.lastCheckAt).toBeInstanceOf(Date);
    expect(res.json()).toMatchObject({ status: 'ERROR', lastError: 'credenciais recusadas' });
    await app.close();
  });

  it('COMMERCE config with an unknown key → 400 and nothing stored', async () => {
    const fake = integrationFake();
    const { app } = await internalApp(fake);
    const res = await app.inject(putCommerce({ provider: 'UAPPI', config: { apiKey: 'demo-key-123' }, secrets: commerceBody.secrets }));
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).not.toContain('demo-key-123');
    expect(fake.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it('stored secrets contain only the parsed keys', async () => {
    const fake = integrationFake();
    const { app, secretBox } = await internalApp(fake);
    const res = await app.inject(putCommerce({
      provider: 'UAPPI', config: {}, secrets: { ...commerceBody.secrets, extra: 'lixo' },
    }));
    expect(res.statusCode).toBe(200);
    const stored = fake.upsert.mock.calls[0][0].create.secrets as string;
    expect(Object.keys(decryptSecrets(secretBox, stored) ?? {}).sort()).toEqual(['apiKey', 'secretKey']);
    await app.close();
  });

  it('COMMERCE invalid settings → 400', async () => {
    const { app } = await internalApp(integrationFake(), {
      connector: { parseSettings: jest.fn(() => { throw new Error('storeId obrigatório'); }) },
    });
    const res = await app.inject(putCommerce(commerceBody));
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('wrong provider for kind → 400', async () => {
    const { app } = await internalApp(integrationFake());
    const res = await app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/integrations/WEB_ANALYTICS', headers: headers(),
      payload: { provider: 'UAPPI', config: { propertyId: '123' } },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('non-commerce kind validates with its schema and stores OK', async () => {
    const fake = integrationFake();
    const { app } = await internalApp(fake);
    const put = (config: object) => app.inject({
      method: 'PUT', url: '/internal/organizations/org_1/integrations/WEB_ANALYTICS', headers: headers(),
      payload: { provider: 'GA4', config },
    });
    expect((await put({ propertyId: 'abc' })).statusCode).toBe(400);
    expect((await put({ propertyId: '123' })).statusCode).toBe(200);
    expect(fake.upsert.mock.calls[0][0].create).toMatchObject({ status: 'OK' });
    await app.close();
  });

  it('audit metadata has secretsChanged and no secret', async () => {
    const { app, auditCreate } = await internalApp(integrationFake());
    await app.inject(putCommerce(commerceBody));
    const calls = auditCreate.mock.calls as unknown as Array<[{ data: Record<string, unknown> }]>;
    const { data } = calls[0][0];
    expect(data.action).toBe('integration.upsert');
    expect(data.organizationId).toBe('org_1');
    expect(data.metadata).toEqual({ kind: 'COMMERCE', provider: 'UAPPI', secretsChanged: true });
    expect(JSON.stringify(data)).not.toContain('demo-key-123');
    await app.close();
  });

  it('serviceAccountEmail comes from the credentials JSON', async () => {
    const fake = integrationFake();
    fake.integration.findMany = jest.fn(async () => [row('WEB_ANALYTICS'), row('APP_ANALYTICS')]);
    const { app } = await internalApp(fake, {
      config: { ga4CredentialsJson: JSON.stringify({ client_email: 'web@sa.iam.gserviceaccount.com' }), ga4AppCredentialsJson: 'nao-e-json' },
    });
    const res = await app.inject({ method: 'GET', url: '/internal/organizations/org_1/integrations', headers: headers() });
    const [web, appView] = res.json();
    expect(web.serviceAccountEmail).toBe('web@sa.iam.gserviceaccount.com');
    // APP com JSON inválido cai no primeiro
    expect(appView.serviceAccountEmail).toBe('web@sa.iam.gserviceaccount.com');
    await app.close();
  });

  it('serviceAccountEmail is null for empty JSON and COMMERCE exposes sync state', async () => {
    const fake = integrationFake();
    fake.integration.findMany = jest.fn(async () => [row('WEB_ANALYTICS'), row('COMMERCE', { provider: 'UAPPI', secrets: 'v1:x' })]);
    const { app } = await internalApp(fake);
    const res = await app.inject({ method: 'GET', url: '/internal/organizations/org_1/integrations', headers: headers() });
    const [web, commerce] = res.json();
    expect(web.serviceAccountEmail).toBeNull();
    expect(commerce.lastSyncedAt).toBe('2026-11-01T00:00:00.000Z');
    expect(commerce.syncError).toBeNull();
    expect(commerce.secretsConfigured).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain('v1:');
    await app.close();
  });

  it('check on WEB_ANALYTICS → 400', async () => {
    const { app } = await internalApp(integrationFake());
    const res = await app.inject({
      method: 'POST', url: '/internal/organizations/org_1/integrations/WEB_ANALYTICS/check', headers: headers(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('sem verificação automática para este tipo');
    await app.close();
  });

  it('requires an operator token', async () => {
    const { app } = await internalApp(integrationFake());
    const res = await app.inject({ method: 'GET', url: '/internal/organizations/org_1/integrations' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

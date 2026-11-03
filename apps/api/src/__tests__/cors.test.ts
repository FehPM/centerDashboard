import type { PrismaClient } from '@prisma/client';
import { Pseudonymizer } from '@center/pii';
import { SecretBox } from '@center/secrets';
import { buildServer } from '../server.js';
import { testConfig as config } from './helpers/config.js';

async function build() {
  return buildServer({
    config,
    prisma: {} as unknown as PrismaClient,
    pseudonymizer: new Pseudonymizer(config.piiPepper),
    secretBox: new SecretBox(config.credentialsEncryptionKey),
    gateway: {} as never,
    queue: { enqueue: jest.fn(async () => {}) },
  });
}

async function preflight(url: string, origin: string) {
  const app = await build();
  const response = await app.inject({
    method: 'OPTIONS', url,
    headers: { origin, 'access-control-request-method': 'POST' },
  });
  await app.close();
  return response.headers['access-control-allow-origin'];
}

describe('CORS por área', () => {
  it('/internal/auth/login allows backofficeOrigin and not panelOrigin', async () => {
    expect(await preflight('/internal/auth/login', config.backofficeOrigin)).toBe(config.backofficeOrigin);
    expect(await preflight('/internal/auth/login', config.panelOrigin)).toBeUndefined();
  });

  it('/api/metrics/catalog allows panelOrigin and not backofficeOrigin', async () => {
    expect(await preflight('/api/metrics/catalog', config.panelOrigin)).toBe(config.panelOrigin);
    expect(await preflight('/api/metrics/catalog', config.backofficeOrigin)).toBeUndefined();
  });

  it('/public/attribution allows any origin', async () => {
    expect(await preflight('/public/attribution', 'https://loja-qualquer.com.br'))
      .toBe('https://loja-qualquer.com.br');
  });
});

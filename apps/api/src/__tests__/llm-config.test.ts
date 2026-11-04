import type { PrismaClient } from '@prisma/client';
import { SecretBox } from '@center/secrets';
import { internalApp } from './helpers/internal-app.js';
import { bearer, operatorToken } from './helpers/operator.js';
import { testConfig } from './helpers/config.js';
import { encryptSecrets } from '../integrations/repository.js';
import { markLlmCredentialsRejected, resolveLlm } from '../agent/llm.js';
import { summarizeUsage } from '../agent/usage.js';

const box = new SecretBox(testConfig.credentialsEncryptionKey);
const putLlm = (payload: unknown) => ({
  method: 'PUT' as const, url: '/internal/organizations/org_1/integrations/LLM',
  headers: bearer(operatorToken()), payload: payload as object,
});

function integrationFake(existing: Record<string, unknown> | null = null) {
  const upsert = jest.fn(async (args: { create: Record<string, unknown> }) => ({
    config: {}, lastCheckAt: null, lastError: null, secretsUpdatedAt: null, secrets: null, ...args.create,
  }));
  return {
    upsert,
    integration: { findUnique: jest.fn(async () => existing), findMany: jest.fn(async () => []), upsert, update: jest.fn() },
    syncState: { findFirst: jest.fn(async () => null) },
  };
}

describe('LLM integration (backoffice)', () => {
  it('OWN stores the key encrypted and never returns it, only the last 4 chars', async () => {
    const fake = integrationFake();
    const { app } = await internalApp(fake);
    const res = await app.inject(putLlm({
      provider: 'ANTHROPIC', config: { mode: 'OWN', label: 'Chave produção' }, secrets: { apiKey: 'sk-ant-abcdef1234' },
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain('sk-ant-abcdef1234');
    expect(res.json()).toMatchObject({ secretsConfigured: true, keyHint: '…1234' });
    expect(fake.upsert.mock.calls[0][0].create.secrets as string).not.toContain('sk-ant');
    await app.close();
  });

  it('OWN without a key is rejected', async () => {
    const { app } = await internalApp(integrationFake());
    const res = await app.inject(putLlm({ provider: 'ANTHROPIC', config: { mode: 'OWN', label: 'Minha' } }));
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('MANAGED refuses a key and clears a previously stored one', async () => {
    const cipher = encryptSecrets(box, { apiKey: 'sk-ant-old0000' });
    const fake = integrationFake({ secrets: cipher });
    const { app } = await internalApp(fake);
    const withKey = await app.inject(putLlm({
      provider: 'ANTHROPIC', config: { mode: 'MANAGED', label: 'Blan' }, secrets: { apiKey: 'x' },
    }));
    expect(withKey.statusCode).toBe(400);
    const res = await app.inject(putLlm({ provider: 'ANTHROPIC', config: { mode: 'MANAGED', label: 'Blan' } }));
    expect(res.statusCode).toBe(200);
    const update = (fake.upsert.mock.calls[0][0] as unknown as { update: Record<string, unknown> }).update;
    expect(update).toMatchObject({ secrets: null, secretsUpdatedAt: null });
    await app.close();
  });

  it('a billing flag cannot be set by the client: unknown config keys are refused', async () => {
    const { app } = await internalApp(integrationFake());
    const res = await app.inject(putLlm({
      provider: 'ANTHROPIC', config: { mode: 'OWN', label: 'x', billable: false }, secrets: { apiKey: 'k' },
    }));
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

function prismaWith(integration: unknown) {
  return {
    integration: {
      findUnique: jest.fn(async () => integration),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  } as unknown as PrismaClient;
}

describe('resolveLlm', () => {
  it('no integration → platform key, billed (MANAGED)', async () => {
    const llm = await resolveLlm(prismaWith(null), box, 'org_1', 'platform-key');
    expect(llm).toEqual({ mode: 'MANAGED', keyLabel: 'Plataforma' });
  });

  it('disabled integration → platform key', async () => {
    const llm = await resolveLlm(prismaWith({ status: 'DISABLED', config: {}, secrets: null }), box, 'org_1', 'k');
    expect(llm.mode).toBe('MANAGED');
  });

  it('OWN → client key with its label, never falls back to the platform', async () => {
    const llm = await resolveLlm(prismaWith({
      status: 'OK', config: { mode: 'OWN', label: 'Chave produção' }, secrets: encryptSecrets(box, { apiKey: 'sk-own' }),
    }), box, 'org_1', 'platform-key');
    expect(llm).toMatchObject({ mode: 'OWN', keyLabel: 'Chave produção' });
    expect(llm.model).toBeDefined();
  });

  it('MANAGED with a label keeps the label', async () => {
    const llm = await resolveLlm(prismaWith({
      status: 'OK', config: { mode: 'MANAGED', label: 'Plano Pro' }, secrets: null,
    }), box, 'org_1', 'platform-key');
    expect(llm).toMatchObject({ mode: 'MANAGED', keyLabel: 'Plano Pro' });
  });

  it('markLlmCredentialsRejected flips the integration to ERROR but never touches a disabled one', async () => {
    const prisma = prismaWith(null);
    await markLlmCredentialsRejected(prisma, 'org_1');
    expect(prisma.integration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org_1', kind: 'LLM', status: { not: 'DISABLED' } },
      data: expect.objectContaining({ status: 'ERROR' }),
    }));
  });
});

describe('summarizeUsage', () => {
  it('merges legacy rows (no mode) into the platform key and totals the tokens', async () => {
    const prisma = {
      message: {
        groupBy: jest.fn(async () => [
          { llmMode: null, llmKeyLabel: null, _count: { _all: 3 }, _sum: { inputTokens: 1000, outputTokens: 200 } },
          { llmMode: 'MANAGED', llmKeyLabel: 'Plataforma', _count: { _all: 2 }, _sum: { inputTokens: 500, outputTokens: 100 } },
          { llmMode: 'OWN', llmKeyLabel: 'Chave produção', _count: { _all: 1 }, _sum: { inputTokens: null, outputTokens: null } },
        ]),
      },
    } as unknown as PrismaClient;
    const summary = await summarizeUsage(prisma, 'org_1', { from: '2026-11-01', to: '2026-11-30' });
    expect(summary.byKey).toEqual([
      { mode: 'MANAGED', keyLabel: 'Plataforma', messages: 5, inputTokens: 1500, outputTokens: 300 },
      { mode: 'OWN', keyLabel: 'Chave produção', messages: 1, inputTokens: 0, outputTokens: 0 },
    ]);
    expect(summary.totals).toEqual({ messages: 6, inputTokens: 1500, outputTokens: 300 });
  });
});

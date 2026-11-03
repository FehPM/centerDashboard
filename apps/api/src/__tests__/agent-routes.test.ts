import type { PrismaClient } from '@prisma/client';
import type { MetricGateway } from '@center/mcp-core';
import { Pseudonymizer } from '@center/pii';
import { SecretBox } from '@center/secrets';
import * as agentModule from '../agent/agent.js';
import { buildServer } from '../server.js';
import { hashPassword } from '../auth/password.js';
import { testConfig } from './helpers/config.js';

// Mesmo padrão de whatsapp-worker.test.ts: `runAgent` chama a API real da
// Anthropic quando nenhum `model` é injetado — mockar aqui evita rede numa
// suíte de unidade.
jest.mock('../agent/agent.js', () => ({
  ...jest.requireActual('../agent/agent.js'),
  runAgent: jest.fn(),
}));
const runAgent = agentModule.runAgent as jest.Mock;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function setup(modules: string[] = ['assistant']) {
  const gateway = {} as unknown as MetricGateway;

  const conversationRow = { id: 'conv_1', userId: 'user_1', organizationId: 'org_1' };
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        id: 'user_1', email: 'ana@example.com', name: 'Ana', role: 'ADMIN' as const,
        organizationId: 'org_1', passwordHash: await hashPassword('segredo123'),
        active: true, mustChangePassword: false,
      })),
    },
    organization: {
      findUnique: jest.fn(async () => ({
        id: 'org_1', status: 'ACTIVE',
      })),
    },
    organizationModule: {
      findMany: jest.fn(async () => modules.map((moduleKey) => ({
        moduleKey, status: 'ACTIVE', startsAt: new Date('2020-01-01'), endsAt: null,
      }))),
    },
    userModuleAccess: { findMany: jest.fn(async () => []) },
    integration: { findMany: jest.fn(async () => []) },
    conversation: {
      findFirst: jest.fn(async () => conversationRow),
      create: jest.fn(async () => conversationRow),
      update: jest.fn(async () => conversationRow),
    },
    message: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: 'msg_1' })),
    },
    toolCallLog: { createMany: jest.fn(async () => ({ count: 0 })) },
  } as unknown as PrismaClient;

  const app = await buildServer({
    config: testConfig, prisma, gateway,
    pseudonymizer: new Pseudonymizer(testConfig.piiPepper),
    secretBox: new SecretBox(testConfig.credentialsEncryptionKey),
    queue: { enqueue: jest.fn(async () => {}) },
  });
  const login = await app.inject({
    method: 'POST', url: '/auth/login',
    payload: { email: 'ana@example.com', password: 'segredo123' },
  });
  return { app, prisma, token: login.json().token as string };
}

beforeEach(() => {
  runAgent.mockReset();
  runAgent.mockResolvedValue({
    reply: 'Você faturou R$ 4.800,00.', toolCalls: [],
    usage: { model: 'mock-model', inputTokens: 12, outputTokens: 7 },
  });
});

describe('GET /api/agent/conversation', () => {
  it('requires a token', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/agent/conversation' })).statusCode).toBe(401);
    await app.close();
  });

  it('returns the conversation history for the logged-in user', async () => {
    const { app, prisma, token } = await setup();
    (prisma.message.findMany as jest.Mock).mockResolvedValueOnce([
      { role: 'ASSISTANT', content: 'oi' }, { role: 'USER', content: 'olá' },
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/agent/conversation', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      conversationId: 'conv_1',
      messages: [{ role: 'user', content: 'olá' }, { role: 'assistant', content: 'oi' }],
    });
    await app.close();
  });
});

describe('POST /api/agent/ask', () => {
  it('requires a token', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/agent/ask', payload: { message: 'oi' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an empty message', async () => {
    const { app, token } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/api/agent/ask', headers: auth(token), payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(runAgent).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a message over 2000 characters', async () => {
    const { app, token } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/api/agent/ask', headers: auth(token), payload: { message: 'a'.repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('runs the agent with the tenant resolved from the logged-in org, not the body', async () => {
    const { app, token } = await setup();
    const res = await app.inject({
      method: 'POST', url: '/api/agent/ask', headers: auth(token),
      payload: { message: 'quanto vendemos?', tenant: { organizationId: 'org_forjada' } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ conversationId: 'conv_1', reply: 'Você faturou R$ 4.800,00.' });
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: 'quanto vendemos?',
      tenant: expect.objectContaining({ organizationId: 'org_1' }),
    }));
    await app.close();
  });

  it('persists the exchange after the agent replies', async () => {
    const { app, prisma, token } = await setup();
    await app.inject({
      method: 'POST', url: '/api/agent/ask', headers: auth(token), payload: { message: 'oi' },
    });

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: { conversationId: 'conv_1', role: 'USER', content: 'oi' },
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: 'conv_1', role: 'ASSISTANT', content: 'Você faturou R$ 4.800,00.' }),
    });
    await app.close();
  });

  it('stores model and token usage on the assistant message', async () => {
    const { app, prisma, token } = await setup();
    await app.inject({
      method: 'POST', url: '/api/agent/ask', headers: auth(token), payload: { message: 'oi' },
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'ASSISTANT', model: 'mock-model', inputTokens: 12, outputTokens: 7 }),
    });
    await app.close();
  });

  it('passes the module access of the user to the agent', async () => {
    const { app, token } = await setup();
    await app.inject({
      method: 'POST', url: '/api/agent/ask', headers: auth(token), payload: { message: 'oi' },
    });
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
      access: expect.objectContaining({ modules: ['assistant'] }),
    }));
    await app.close();
  });

  it('POST /api/agent/ask without the assistant module → 403 module_not_available', async () => {
    const { app, token } = await setup(['overview']);
    const res = await app.inject({
      method: 'POST', url: '/api/agent/ask', headers: auth(token), payload: { message: 'oi' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('module_not_available');
    expect(runAgent).not.toHaveBeenCalled();
    await app.close();
  });
});

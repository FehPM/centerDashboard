import type { PrismaClient } from '@prisma/client';
import type { MetricGateway } from '@center/mcp-core';
import type { CommerceConnector, ConnectorRegistry } from '@center/connectors';
import { Pseudonymizer } from '@center/pii';
import { SecretBox } from '@center/secrets';
import { buildServer } from '../../server.js';
import { testConfig } from './config.js';

/** Servidor com Prisma falso para as rotas `/internal/*`; o conector Uappi é um stub. */
export async function internalApp(
  prismaParts: Record<string, unknown>,
  opts: { connector?: Partial<CommerceConnector>; config?: Partial<typeof testConfig> } = {},
) {
  const auditCreate = jest.fn(async () => ({}));
  const prisma = {
    platformOperator: {
      findUnique: jest.fn(async () => ({ id: 'op_1', email: 'op@blan.com', name: 'Operador', active: true })),
    },
    operatorAuditLog: { create: auditCreate },
    organization: { findUnique: jest.fn(async (a: { where: { id: string } }) => ({ id: a.where.id })) },
    ...prismaParts,
  } as unknown as PrismaClient;
  const connector = {
    // Imita o conector: só apiKey/secretKey sobrevivem como credenciais.
    parseSettings: jest.fn((config: unknown, secrets: unknown) => {
      const s = (secrets ?? {}) as Record<string, unknown>;
      return { config, credentials: { apiKey: s.apiKey, secretKey: s.secretKey } };
    }),
    check: jest.fn(async () => ({ ok: true as const })),
    ...opts.connector,
  } as unknown as CommerceConnector;
  const connectors = { get: () => connector } as ConnectorRegistry;
  const secretBox = new SecretBox(testConfig.credentialsEncryptionKey);
  const app = await buildServer({
    config: { ...testConfig, ...opts.config }, prisma,
    gateway: { listMetrics: jest.fn(async () => []) } as unknown as MetricGateway,
    pseudonymizer: new Pseudonymizer(testConfig.piiPepper),
    secretBox, queue: { enqueue: jest.fn(async () => {}) }, connectors,
  });
  return { app, prisma, auditCreate, connector, secretBox };
}

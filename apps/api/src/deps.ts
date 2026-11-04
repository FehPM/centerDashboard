import type { PrismaClient } from '@prisma/client';
import type { MetricGateway } from '@center/mcp-core';
import type { Pseudonymizer } from '@center/pii';
import type { ConnectorRegistry } from '@center/connectors';
import type { SecretBox } from '@center/secrets';
import type { AppConfig } from './config.js';
import type { MessageQueue } from './whatsapp/queue.js';

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  gateway: MetricGateway;
  pseudonymizer: Pseudonymizer;
  /** Decifra `Integration.secrets` — usado pelas rotas de configuração (T24B). */
  secretBox: SecretBox;
  queue: MessageQueue;
  /** Conectores de e-commerce (a Uappi é o primeiro). */
  connectors: ConnectorRegistry;
}

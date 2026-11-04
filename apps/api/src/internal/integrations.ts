import type { FastifyInstance } from 'fastify';
import type { CommerceProvider } from '@center/connectors';
import { z } from 'zod';
import type { IntegrationKind } from '@center/entitlements';
import type { AppDeps } from '../deps.js';
import {
  ALLOWED_PROVIDERS, IntegrationConfigSchemas, IntegrationSecretSchemas,
} from '../integrations/kinds.js';
import { decryptSecrets, encryptSecrets } from '../integrations/repository.js';
import { summarizeUsage } from '../agent/usage.js';
import { assertRange, BadRequestError } from '../range.js';
import { recordAudit } from './audit.js';
import { makeRequireOperator } from './auth/guard.js';

const KINDS = Object.keys(ALLOWED_PROVIDERS) as IntegrationKind[];

const PutBody = z.object({
  provider: z.string(),
  config: z.record(z.unknown()),
  secrets: z.record(z.unknown()).optional(),
});

// Config de COMMERCE por provedor, estrita: chave desconhecida (ex.: credencial colada no
// lugar errado) é recusada em vez de gravada em claro.
const CommerceConfigSchemas: Record<CommerceProvider, z.ZodType<Record<string, unknown>>> = {
  UAPPI: z.object({ statusMapping: z.record(z.string()).optional() }).strict(),
};

const orgNotFound = { error: 'not_found', message: 'cliente não encontrado' };
const integrationNotFound = { error: 'not_found', message: 'integração não configurada' };
const badRequest = (message: string) => ({ error: 'bad_request', message });

const SELECT = {
  kind: true, provider: true, config: true, status: true, lastCheckAt: true, lastError: true,
  secrets: true, secretsUpdatedAt: true,
} as const;

/** E-mail da service account da Blan (`client_email`); JSON vazio ou inválido → null. */
function clientEmail(json: string): string | null {
  if (!json) return null;
  try {
    const value = (JSON.parse(json) as { client_email?: unknown }).client_email;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

function zodMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; ');
  }
  return error instanceof Error ? error.message : 'dados inválidos';
}

export async function registerIntegrationRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma, config, secretBox, connectors } = deps;
  const preHandler = makeRequireOperator(prisma);

  interface Row {
    kind: IntegrationKind; provider: string; config: unknown; status: string;
    lastCheckAt: Date | null; lastError: string | null; secrets: string | null; secretsUpdatedAt: Date | null;
  }

  // Segredo é só de escrita: a view diz se existe, nunca o valor nem o texto cifrado.
  function present(row: Row, sync?: { lastSyncedAt: Date | null; lastError: string | null } | null) {
    const view: Record<string, unknown> = {
      kind: row.kind, provider: row.provider, config: row.config, status: row.status,
      lastCheckAt: row.lastCheckAt, lastError: row.lastError,
      secretsConfigured: Boolean(row.secrets), secretsUpdatedAt: row.secretsUpdatedAt,
    };
    if (row.kind === 'COMMERCE') {
      view.lastSyncedAt = sync?.lastSyncedAt ?? null;
      view.syncError = sync?.lastError ?? null;
    }
    if (row.kind === 'LLM' && row.secrets) {
      const apiKey = decryptSecrets(secretBox, row.secrets)?.apiKey;
      view.keyHint = typeof apiKey === 'string' && apiKey.length >= 4 ? `…${apiKey.slice(-4)}` : null;
    }
    if (row.kind === 'WEB_ANALYTICS') view.serviceAccountEmail = clientEmail(config.ga4CredentialsJson);
    if (row.kind === 'APP_ANALYTICS') {
      view.serviceAccountEmail = clientEmail(config.ga4AppCredentialsJson) ?? clientEmail(config.ga4CredentialsJson);
    }
    return view;
  }

  async function loadSync(organizationId: string) {
    return prisma.syncState.findFirst({
      where: { organizationId, resource: 'orders' }, select: { lastSyncedAt: true, lastError: true },
    });
  }

  const parseKind = (raw: string): IntegrationKind | null =>
    (KINDS as string[]).includes(raw) ? (raw as IntegrationKind) : null;

  scope.get<{ Params: { id: string } }>('/organizations/:id/integrations', { preHandler }, async (request, reply) => {
    const org = await prisma.organization.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!org) return reply.status(404).send(orgNotFound);
    const rows = await prisma.integration.findMany({ where: { organizationId: org.id }, select: SELECT });
    const sync = rows.some((r) => r.kind === 'COMMERCE') ? await loadSync(org.id) : null;
    return rows.map((row) => present(row as Row, sync));
  });

  // Base da cobrança por uso: tokens por chave (modo + nome) no período.
  scope.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/organizations/:id/llm-usage', { preHandler }, async (request, reply) => {
      const org = await prisma.organization.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!org) return reply.status(404).send(orgNotFound);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const to = request.query.to ?? today;
      const from = request.query.from ?? `${today.slice(0, 8)}01`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return reply.status(400).send(badRequest('use datas YYYY-MM-DD'));
      }
      try {
        assertRange({ from, to });
      } catch (error) {
        if (error instanceof BadRequestError) return reply.status(400).send(badRequest(error.message));
        throw error;
      }
      return summarizeUsage(prisma, org.id, { from, to });
    });

  scope.put<{ Params: { id: string; kind: string } }>(
    '/organizations/:id/integrations/:kind', { preHandler }, async (request, reply) => {
      const kind = parseKind(request.params.kind);
      if (!kind) return reply.status(400).send(badRequest('tipo de integração inválido'));
      const body = PutBody.safeParse(request.body);
      if (!body.success) return reply.status(400).send(badRequest('informe provider e config'));
      if (body.data.provider !== ALLOWED_PROVIDERS[kind]) {
        return reply.status(400).send(badRequest(`provedor inválido para ${kind}`));
      }
      const org = await prisma.organization.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!org) return reply.status(404).send(orgNotFound);
      const organizationId = org.id;
      const provider = ALLOWED_PROVIDERS[kind];

      const current = await prisma.integration.findUnique({
        where: { organizationId_kind: { organizationId, kind } }, select: { secrets: true },
      });
      const newSecrets = body.data.secrets;
      const effectiveSecrets = newSecrets ?? decryptSecrets(secretBox, current?.secrets ?? null);

      let status: 'OK' | 'ERROR' = 'OK';
      let lastCheckAt: Date | undefined;
      let lastError: string | null = null;
      let configToStore: Record<string, unknown> = body.data.config;

      let secretsToStore: Record<string, unknown> | undefined = newSecrets;
      let clearSecrets = false;

      if (kind === 'COMMERCE') {
        const commerceProvider = provider as CommerceProvider;
        const parsedConfig = CommerceConfigSchemas[commerceProvider].safeParse(body.data.config);
        if (!parsedConfig.success) return reply.status(400).send(badRequest(zodMessage(parsedConfig.error)));
        configToStore = parsedConfig.data;
        const connector = connectors.get(commerceProvider);
        let settings: unknown;
        try {
          settings = connector.parseSettings(configToStore, effectiveSecrets);
        } catch (error) {
          return reply.status(400).send(badRequest(zodMessage(error)));
        }
        // Grava só as credenciais que o conector reconheceu.
        if (newSecrets) secretsToStore = (settings as { credentials: Record<string, unknown> }).credentials;
        const result = await connector.check(settings);
        lastCheckAt = new Date();
        if (!result.ok) { status = 'ERROR'; lastError = result.error; }
      } else {
        const parsedConfig = IntegrationConfigSchemas[kind].safeParse(body.data.config);
        if (!parsedConfig.success) return reply.status(400).send(badRequest(zodMessage(parsedConfig.error)));
        configToStore = parsedConfig.data;
        if (kind === 'LLM') {
          const llmConfig = parsedConfig.data as { mode: 'OWN' | 'MANAGED' };
          if (llmConfig.mode === 'MANAGED') {
            if (newSecrets) return reply.status(400).send(badRequest('o modo gerenciado não usa chave própria'));
            // Sair do modo próprio não pode deixar a chave do cliente guardada.
            clearSecrets = Boolean(current?.secrets);
          } else {
            const parsedSecrets = IntegrationSecretSchemas.LLM.safeParse(effectiveSecrets ?? {});
            if (!parsedSecrets.success) return reply.status(400).send(badRequest('informe a chave de API (apiKey)'));
            if (newSecrets) secretsToStore = parsedSecrets.data;
          }
        } else if (kind === 'PLAY_STORE' || kind === 'APP_STORE') {
          const parsedSecrets = IntegrationSecretSchemas[kind].safeParse(effectiveSecrets ?? {});
          if (!parsedSecrets.success) return reply.status(400).send(badRequest(zodMessage(parsedSecrets.error)));
          if (newSecrets) secretsToStore = parsedSecrets.data;
        } else if (newSecrets) {
          return reply.status(400).send(badRequest('este tipo não usa segredos'));
        }
      }

      const secretsData = secretsToStore
        ? { secrets: encryptSecrets(secretBox, secretsToStore), secretsUpdatedAt: new Date() }
        : clearSecrets ? { secrets: null, secretsUpdatedAt: null } : {};
      const common = { provider, config: configToStore as never, status, lastError, ...(lastCheckAt ? { lastCheckAt } : {}) };
      const saved = await prisma.integration.upsert({
        where: { organizationId_kind: { organizationId, kind } },
        create: { organizationId, kind, ...common, ...secretsData },
        update: { ...common, ...secretsData },
        select: SELECT,
      });
      await recordAudit(prisma, request, {
        action: 'integration.upsert', organizationId, targetType: 'Integration', targetId: kind,
        metadata: { kind, provider, secretsChanged: Boolean(newSecrets) },
      });
      const sync = kind === 'COMMERCE' ? await loadSync(organizationId) : null;
      return present(saved as Row, sync);
    });

  scope.post<{ Params: { id: string; kind: string } }>(
    '/organizations/:id/integrations/:kind/check', { preHandler }, async (request, reply) => {
      const kind = parseKind(request.params.kind);
      if (!kind) return reply.status(400).send(badRequest('tipo de integração inválido'));
      if (kind !== 'COMMERCE') return reply.status(400).send(badRequest('sem verificação automática para este tipo'));
      const organizationId = request.params.id;
      const row = await prisma.integration.findUnique({
        where: { organizationId_kind: { organizationId, kind } }, select: SELECT,
      });
      if (!row) return reply.status(404).send(integrationNotFound);
      const connector = connectors.get(row.provider as CommerceProvider);
      let settings: unknown;
      try {
        settings = connector.parseSettings(row.config, decryptSecrets(secretBox, row.secrets));
      } catch (error) {
        return reply.status(400).send(badRequest(zodMessage(error)));
      }
      const result = await connector.check(settings);
      // "Testar" não religa uma integração desativada (o sync voltaria a rodar
      // sem uma ação registrada como tal): só grava o resultado do teste.
      const status = row.status === 'DISABLED' ? 'DISABLED' : result.ok ? 'OK' : 'ERROR';
      const saved = await prisma.integration.update({
        where: { organizationId_kind: { organizationId, kind } },
        data: { status, lastCheckAt: new Date(), lastError: result.ok ? null : result.error },
        select: SELECT,
      });
      await recordAudit(prisma, request, {
        action: 'integration.check', organizationId, targetType: 'Integration', targetId: kind,
        metadata: { kind, ok: result.ok },
      });
      return present(saved as Row, await loadSync(organizationId));
    });

  scope.post<{ Params: { id: string; kind: string } }>(
    '/organizations/:id/integrations/:kind/disable', { preHandler }, async (request, reply) => {
      const kind = parseKind(request.params.kind);
      if (!kind) return reply.status(400).send(badRequest('tipo de integração inválido'));
      const organizationId = request.params.id;
      const row = await prisma.integration.findUnique({
        where: { organizationId_kind: { organizationId, kind } }, select: { kind: true },
      });
      if (!row) return reply.status(404).send(integrationNotFound);
      const saved = await prisma.integration.update({
        where: { organizationId_kind: { organizationId, kind } }, data: { status: 'DISABLED' }, select: SELECT,
      });
      await recordAudit(prisma, request, {
        action: 'integration.disable', organizationId, targetType: 'Integration', targetId: kind,
        metadata: { kind },
      });
      const sync = kind === 'COMMERCE' ? await loadSync(organizationId) : null;
      return present(saved as Row, sync);
    });
}

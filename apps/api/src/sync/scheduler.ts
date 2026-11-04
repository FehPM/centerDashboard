import type { PrismaClient } from '@prisma/client';
import type { Pseudonymizer } from '@center/pii';
import type { SecretBox } from '@center/secrets';
import { isCredentialsRejected, runCommerceSync, type ConnectorRegistry } from '@center/connectors';
import type { AppConfig } from '../config.js';
import { decryptSecrets } from '../integrations/repository.js';

export interface SchedulerDeps {
  prisma: PrismaClient;
  config: AppConfig;
  pseudonymizer: Pseudonymizer;
  /** Decifra o JSON de segredos de cada `Integration`. */
  secretBox: SecretBox;
  /** Conectores por provedor (o worker o constrói). */
  connectors: ConnectorRegistry;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface SchedulerReport {
  organizations: number;
  succeeded: number;
  failed: number;
}

/**
 * Sincroniza a integração COMMERCE de cada organização, uma por vez.
 *
 * Sequencial de propósito: cada organização tem sua própria cota no provedor,
 * mas o banco é compartilhado, e paralelizar aqui trocaria um gargalo
 * previsível por contenção imprevisível. Uma falha nunca interrompe as demais:
 * nem a do sync, nem a de um provedor desconhecido, nem a de uma gravação de
 * status no banco. Cada integração é contada exatamente uma vez.
 *
 * `Integration.status` (decisão do responsável, 2026-11-04):
 * - `ERROR` só quando a integração não tem como funcionar sem a Blan mexer:
 *   credencial recusada pelo provedor (`CredentialsRejectedError`), segredos
 *   que não decifram/validam, ou provedor desconhecido;
 * - uma falha passageira (provedor fora do ar, timeout, resposta inesperada)
 *   NÃO mexe no status: o runner já gravou `SyncState.lastError` (spec §8) e o
 *   cliente continua vendo os dados sincronizados até `lastSyncedAt`;
 * - um sync bem-sucedido promove a `OK` (inclusive de `ERROR`).
 */
export async function syncAllOrganizations(deps: SchedulerDeps): Promise<SchedulerReport> {
  const log = deps.logger ?? (() => {});
  const checkedAt = () => (deps.now ? deps.now() : new Date());
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

  // Elegível: COMMERCE com segredos, não desativada, de organização ativa.
  const integrations = await deps.prisma.integration.findMany({
    where: {
      kind: 'COMMERCE',
      status: { not: 'DISABLED' },
      secrets: { not: null },
      organization: { status: 'ACTIVE' },
    },
    select: { id: true, organizationId: true, provider: true, status: true, config: true, secrets: true },
  });

  let succeeded = 0;
  let failed = 0;

  /** Grava o status sem nunca lançar: um erro de banco aqui só é logado. */
  const writeStatus = async (
    integration: { id: string; organizationId: string },
    data: { status: 'OK' | 'ERROR'; lastError: string | null },
  ): Promise<void> => {
    try {
      await deps.prisma.integration.update({
        where: { id: integration.id },
        data: { ...data, lastCheckAt: checkedAt() },
      });
    } catch (error) {
      log('falha ao gravar o status da integração', {
        organizationId: integration.organizationId,
        error: describe(error),
      });
    }
  };

  for (const integration of integrations) {
    try {
      let connector;
      try {
        connector = deps.connectors.get(integration.provider as 'UAPPI');
      } catch {
        failed += 1;
        await writeStatus(integration, { status: 'ERROR', lastError: 'conector desconhecido' });
        log('conector desconhecido na integração', {
          organizationId: integration.organizationId, provider: integration.provider,
        });
        continue;
      }

      let settings;
      try {
        // O decrypt acontece aqui, no único ponto que precisa do valor real.
        const secrets = decryptSecrets(deps.secretBox, integration.secrets);
        settings = connector.parseSettings(integration.config, secrets);
      } catch {
        failed += 1;
        await writeStatus(integration, { status: 'ERROR', lastError: 'configuração inválida' });
        log('configuração inválida na integração', { organizationId: integration.organizationId });
        continue;
      }

      let result;
      try {
        result = await runCommerceSync({
          prisma: deps.prisma,
          connector,
          settings,
          pseudonymizer: deps.pseudonymizer,
          organizationId: integration.organizationId,
          ...(deps.now ? { now: deps.now } : {}),
          logger: log,
        }, { backfillDays: deps.config.syncBackfillDays });
      } catch (error) {
        failed += 1;
        if (isCredentialsRejected(error)) {
          // Mensagem fixa do conector, sem corpo da resposta do provedor.
          await writeStatus(integration, { status: 'ERROR', lastError: error.message });
          log('credenciais recusadas pelo provedor', { organizationId: integration.organizationId });
        } else {
          // Falha passageira: `SyncState.lastError` já foi gravado pelo runner.
          // O status fica como está, e os módulos de commerce seguem no ar.
          log('falha no sync da organização', {
            organizationId: integration.organizationId, error: describe(error),
          });
        }
        continue;
      }

      // Sync concluído: a promoção a OK é uma gravação à parte e não pode
      // reclassificar a integração como falha.
      succeeded += 1;
      if (integration.status !== 'OK') {
        await writeStatus(integration, { status: 'OK', lastError: null });
      }
      log('sync concluído', {
        organizationId: integration.organizationId,
        processed: result.ordersProcessed,
        failedOrders: result.ordersFailed,
      });
    } catch (error) {
      // Rede de segurança para o inesperado (ex.: o próprio logger falhando).
      // Não sabemos a causa, então não mexemos no status. Só organizationId e
      // mensagem vão para o log — nunca segredos.
      failed += 1;
      try {
        log('falha no sync da organização', {
          organizationId: integration.organizationId, error: describe(error),
        });
      } catch {
        // logger quebrado: nada a fazer além de seguir para a próxima.
      }
    }
  }

  return { organizations: integrations.length, succeeded, failed };
}

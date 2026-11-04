import { z } from 'zod';
import {
  MockUappiClient,
  UappiApiError,
  UappiClient,
  UappiTokenProvider,
  type UappiClientLike,
  type UappiCredentials,
} from '@center/uappi-client';
import {
  CredentialsRejectedError,
  type CanonicalOrderRecord,
  type CheckResult,
  type CommerceConnector,
  type DateWindow,
  type ReadContext,
  type ReadFailure,
} from '../types.js';
import { UappiOrderSchema, UappiOrderSummarySchema } from './schemas.js';
import { mapOrder } from './mapper.js';

export interface UappiSettings {
  credentials: UappiCredentials;
  statusOverrides: Record<string, string> | null;
}

export interface UappiConnectorOptions {
  baseUrl: string;
  mock: boolean;
  /** Injeção para testes; por padrão constrói o cliente real (ou o mock). */
  buildClient?: (credentials: UappiCredentials) => UappiClientLike;
}

const SecretsSchema = z.object({
  apiKey: z.string().min(1),
  secretKey: z.string().min(1),
});

const ConfigSchema = z.object({
  statusMapping: z.record(z.string()).optional(),
});

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';
const CREDENTIALS_REJECTED = 'credenciais recusadas pela Uappi';

/** 401/403 da Uappi (no token ou na listagem) = credencial recusada. */
function isAuthFailure(error: unknown): boolean {
  return error instanceof UappiApiError && (error.status === 401 || error.status === 403);
}

export function createUappiConnector(opts: UappiConnectorOptions): CommerceConnector<UappiSettings> {
  const buildClient = opts.buildClient ?? ((credentials: UappiCredentials): UappiClientLike => {
    // MOCK_EXTERNAL_APIS=true ignora as credenciais e roda contra a fixture —
    // permite subir o sync sem apiKey/secretKey reais da Uappi.
    if (opts.mock) return new MockUappiClient();

    // Um token provider por chamada: as credenciais são diferentes por loja e o
    // cache de token não pode vazar entre elas.
    const tokenProvider = new UappiTokenProvider({ baseUrl: opts.baseUrl, credentials });
    return new UappiClient({ baseUrl: opts.baseUrl, tokenProvider });
  });

  return {
    provider: 'UAPPI',

    parseSettings(config, secrets): UappiSettings {
      const credentials = SecretsSchema.parse(secrets);
      const { statusMapping } = ConfigSchema.parse(config ?? {});
      return { credentials, statusOverrides: statusMapping ?? null };
    },

    async check(settings): Promise<CheckResult> {
      if (opts.mock) return { ok: true };
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
        await buildClient(settings.credentials).listOrders({ from: today, to: today, offset: 0, limit: 1 });
        return { ok: true };
      } catch (error) {
        if (isAuthFailure(error)) return { ok: false, error: CREDENTIALS_REJECTED };
        return { ok: false, error: 'Uappi indisponível' };
      }
    },

    discover() {
      return ['orders'] as const;
    },

    async *readOrders(
      settings: UappiSettings,
      window: DateWindow,
      ctx: ReadContext,
    ): AsyncGenerator<CanonicalOrderRecord | ReadFailure> {
      const client = buildClient(settings.credentials);

      try {
        yield* readPages(client, settings, window, ctx);
      } catch (error) {
        // Só a listagem chega aqui (falha de um pedido vira ReadFailure).
        // Credencial recusada ganha um erro próprio; o resto sobe como está e
        // é tratado como falha passageira pelo sync.
        if (isAuthFailure(error)) throw new CredentialsRejectedError(CREDENTIALS_REJECTED);
        throw error;
      }
    },
  };
}

async function* readPages(
  client: UappiClientLike,
  settings: UappiSettings,
  window: DateWindow,
  ctx: ReadContext,
): AsyncGenerator<CanonicalOrderRecord | ReadFailure> {
      for await (const page of client.iterateOrders({ from: window.from, to: window.to })) {
        for (const raw of page) {
          const summary = UappiOrderSummarySchema.safeParse(raw);
          if (!summary.success) {
            ctx.logger('pedido da listagem sem numeroPedido, ignorado');
            yield { kind: 'failure', reference: 'sem-numeroPedido', error: 'listagem sem numeroPedido' };
            continue;
          }

          const numeroPedido = summary.data.numeroPedido;
          try {
            const detail = await client.getOrder(numeroPedido);
            const parsed = UappiOrderSchema.parse(detail);
            const { order, items } = mapOrder(parsed, {
              pseudonymizer: ctx.pseudonymizer,
              statusOverrides: settings.statusOverrides,
            });
            yield { kind: 'order', order, items };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger('falha ao ler pedido', { numeroPedido, error: message });
            yield { kind: 'failure', reference: numeroPedido, error: message };
          }
        }
      }
}

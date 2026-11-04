import type { Pseudonymizer } from '@center/pii';
import type { MappedOrder, MappedOrderItem } from './uappi/mapper.js';

export type { MappedOrder, MappedOrderItem };

export type CommerceProvider = 'UAPPI';

/** Janela de datas inclusiva, no formato YYYY-MM-DD. */
export interface DateWindow {
  from: string;
  to: string;
}

export interface ReadContext {
  pseudonymizer: Pseudonymizer;
  logger: (message: string, meta?: Record<string, unknown>) => void;
}

/** Pedido já canônico e pseudonimizado — nenhum dado pessoal em claro. */
export interface CanonicalOrderRecord {
  kind: 'order';
  order: MappedOrder;
  items: MappedOrderItem[];
}

/** Um pedido problemático vira falha contada, nunca interrompe a leitura. */
export interface ReadFailure {
  kind: 'failure';
  reference: string;
  error: string;
}

export type CheckResult = { ok: true } | { ok: false; error: string };

/**
 * O provedor recusou as credenciais da loja (ex.: HTTP 401/403). É a ÚNICA
 * falha de leitura que o conector classifica: só ela leva a integração a
 * `ERROR`. Qualquer outra (provedor fora do ar, timeout, resposta estranha) é
 * passageira — fica em `SyncState.lastError` e o cliente continua vendo os
 * dados já sincronizados. A mensagem é fixa, sem corpo da resposta do
 * provedor.
 */
export class CredentialsRejectedError extends Error {
  constructor(message = 'credenciais recusadas pelo provedor') {
    super(message);
    this.name = 'CredentialsRejectedError';
  }
}

/** Também reconhece pelo nome, para não depender de uma única cópia do módulo. */
export function isCredentialsRejected(error: unknown): error is CredentialsRejectedError {
  return error instanceof CredentialsRejectedError
    || (error instanceof Error && error.name === 'CredentialsRejectedError');
}

export interface CommerceConnector<TSettings = unknown> {
  provider: CommerceProvider;
  /** Valida config + segredos já decifrados; lança ZodError se inválidos. */
  parseSettings(config: unknown, secrets: unknown): TSettings;
  check(settings: TSettings): Promise<CheckResult>;
  discover(): readonly ['orders'];
  /** Lança `CredentialsRejectedError` se o provedor recusar as credenciais. */
  readOrders(
    settings: TSettings,
    window: DateWindow,
    ctx: ReadContext,
  ): AsyncIterable<CanonicalOrderRecord | ReadFailure>;
}

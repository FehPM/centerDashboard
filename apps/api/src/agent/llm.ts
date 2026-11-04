import type { PrismaClient } from '@prisma/client';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { SecretBox } from '@center/secrets';
import { IntegrationConfigSchemas, IntegrationSecretSchemas } from '../integrations/kinds.js';
import { decryptSecrets } from '../integrations/repository.js';
import { DEFAULT_ANTHROPIC_MODEL, defaultModel } from './agent.js';

export const PLATFORM_KEY_LABEL = 'Plataforma';

export interface ResolvedLlm {
  /** `undefined` = o `runAgent` usa o modelo padrão da plataforma. */
  model?: LanguageModel;
  mode: 'OWN' | 'MANAGED';
  keyLabel: string;
}

const PLATFORM_DEFAULT: ResolvedLlm = { mode: 'MANAGED', keyLabel: PLATFORM_KEY_LABEL };

/**
 * Qual chave responde pela IA deste cliente. Sem integração configurada (ou
 * desativada) vale a chave da plataforma, cobrada pelo uso. Com chave própria
 * que falha, NÃO há queda silenciosa para a da plataforma: o cliente seria
 * cobrado sem saber.
 */
export async function resolveLlm(
  prisma: PrismaClient, secretBox: SecretBox, organizationId: string, platformApiKey: string,
): Promise<ResolvedLlm> {
  const row = await prisma.integration.findUnique({
    where: { organizationId_kind: { organizationId, kind: 'LLM' } },
    select: { config: true, secrets: true, status: true },
  });
  if (!row || row.status === 'DISABLED') return PLATFORM_DEFAULT;

  const config = IntegrationConfigSchemas.LLM.safeParse(row.config);
  if (!config.success) return PLATFORM_DEFAULT;
  const { mode, label, model } = config.data;

  if (mode === 'MANAGED') {
    return { mode, keyLabel: label, ...(model ? { model: defaultModel(platformApiKey, model) } : {}) };
  }

  const secrets = IntegrationSecretSchemas.LLM.safeParse(decryptSecrets(secretBox, row.secrets) ?? {});
  const apiKey = secrets.success ? secrets.data.apiKey : '';
  return { mode, keyLabel: label, model: createAnthropic({ apiKey })(model ?? DEFAULT_ANTHROPIC_MODEL) };
}

/** A chave própria foi recusada: a integração vai a ERROR até alguém regravar a chave. */
export async function markLlmCredentialsRejected(prisma: PrismaClient, organizationId: string): Promise<void> {
  await prisma.integration.updateMany({
    where: { organizationId, kind: 'LLM', status: { not: 'DISABLED' } },
    data: { status: 'ERROR', lastCheckAt: new Date(), lastError: 'chave recusada pelo provedor' },
  });
}

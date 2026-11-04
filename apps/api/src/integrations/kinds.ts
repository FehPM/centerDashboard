import { z } from 'zod';
import type { IntegrationProvider } from '@prisma/client';
import type { IntegrationKind } from '@center/entitlements';

const propertyId = z.string().regex(/^\d+$/);

/** Config NÃO secreta por tipo. COMMERCE é validado pelo conector (Task 5). */
export const IntegrationConfigSchemas = {
  WEB_ANALYTICS: z.object({ propertyId, bigQueryDataset: z.string().min(1).optional() }),
  APP_ANALYTICS: z.object({ propertyId }),
  PLAY_STORE: z.object({ packageName: z.string().min(1) }),
  APP_STORE: z.object({ appId: z.string().min(1) }),
  SPRINT_BOARD: z.object({ boardId: z.string().min(1) }),
  // OWN: chave do cliente (cobrança fora de nós). MANAGED: chave da plataforma,
  // cobrada pelo uso. O modo decide a cobrança — nunca um campo à parte.
  LLM: z.object({
    mode: z.enum(['OWN', 'MANAGED']),
    label: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(100).optional(),
  }).strict(),
};

/** Segredos (cifrados em `Integration.secrets`) por tipo. */
export const IntegrationSecretSchemas = {
  PLAY_STORE: z.object({ credentialsJson: z.string().min(1) }),
  APP_STORE: z.object({ keyJson: z.string().min(1) }),
  LLM: z.object({ apiKey: z.string().trim().min(1) }).strict(),
};

/** Cada tipo de integração só aceita um provedor. */
export const ALLOWED_PROVIDERS: Record<IntegrationKind, IntegrationProvider> = {
  COMMERCE: 'UAPPI',
  WEB_ANALYTICS: 'GA4',
  APP_ANALYTICS: 'GA4',
  PLAY_STORE: 'GOOGLE_PLAY',
  APP_STORE: 'APP_STORE_CONNECT',
  SPRINT_BOARD: 'MONDAY',
  LLM: 'ANTHROPIC',
};

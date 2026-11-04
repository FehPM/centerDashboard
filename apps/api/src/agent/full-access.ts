import { MODULE_KEYS, allowedSources } from '@center/entitlements';
import type { AgentToolContext } from './tools.js';

/**
 * Acesso irrestrito, SÓ para scripts (avaliação do agente) e testes. NUNCA use
 * em caminho de requisição ou de worker: lá o acesso vem de `getAccess`/`loadAccess`.
 */
export function fullAccess(): AgentToolContext['access'] {
  const modules = [...MODULE_KEYS];
  return { modules, sources: allowedSources(modules) };
}

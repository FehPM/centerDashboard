import type { PrismaClient } from '@prisma/client';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { moduleReadiness, type ModuleKey, type SourceDecision } from '@center/entitlements';
import { loadAccess, type AccessContext } from './access.js';

const cache = new WeakMap<FastifyRequest, Promise<AccessContext>>();

/** Acesso da requisição, memoizado: uma rota nunca consulta o banco duas vezes. */
export function getAccess(request: FastifyRequest, prisma: PrismaClient): Promise<AccessContext> {
  let pending = cache.get(request);
  if (!pending) {
    pending = loadAccess(prisma, request.auth, new Date());
    cache.set(request, pending);
  }
  return pending;
}

const NOT_AVAILABLE = { error: 'module_not_available', message: 'módulo não disponível para este usuário' };
const PENDING = { error: 'integration_pending', message: 'integração ainda não configurada pela equipe Blan' };

/** Responde 403/409 para a decisão; null quando permitido. */
export function replyForDecision(reply: FastifyReply, decision: SourceDecision): FastifyReply | null {
  if (decision === 'forbidden') return reply.status(403).send(NOT_AVAILABLE);
  if (decision === 'pending') return reply.status(409).send(PENDING);
  return null;
}

export function requireModule(key: ModuleKey, prisma: PrismaClient): preHandlerAsyncHookHandler {
  return async function requireModuleHook(request, reply) {
    const access = await getAccess(request, prisma);
    if (!access.modules.includes(key)) {
      return reply.status(403).send(NOT_AVAILABLE);
    }
    if (moduleReadiness(key, access.integrations) !== 'ready') {
      return reply.status(409).send(PENDING);
    }
  };
}


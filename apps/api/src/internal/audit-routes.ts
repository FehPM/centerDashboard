import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { makeRequireOperator } from './auth/guard.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const Query = z.object({
  organizationId: z.string().min(1).optional(),
  operatorId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

export async function registerAuditRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma } = deps;
  const preHandler = makeRequireOperator(prisma);

  scope.get('/audit', { preHandler }, async (request, reply) => {
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'bad_request', message: 'filtros inválidos' });
    const q = parsed.data;
    return prisma.operatorAuditLog.findMany({
      where: {
        organizationId: q.organizationId,
        operatorId: q.operatorId,
        action: q.action,
        createdAt: q.before ? { lt: new Date(q.before) } : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      select: {
        id: true, operatorId: true, action: true, organizationId: true, targetType: true,
        targetId: true, metadata: true, createdAt: true,
      },
    });
  });
}

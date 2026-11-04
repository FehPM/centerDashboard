import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../deps.js';
import { recordAudit } from './audit.js';
import { makeRequireOperator } from './auth/guard.js';
import { CreateOperatorError, createOperator } from './create-operator.js';

const CreateBody = z.object({ email: z.string(), name: z.string(), password: z.string() });

export async function registerOperatorRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma } = deps;
  const preHandler = makeRequireOperator(prisma);

  scope.get('/operators', { preHandler }, async () => {
    return prisma.platformOperator.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, active: true, lastLoginAt: true, createdAt: true },
    });
  });

  scope.post('/operators', { preHandler }, async (request, reply) => {
    const body = CreateBody.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'bad_request', message: 'dados inválidos' });
    try {
      const { id } = await createOperator(prisma, body.data);
      await recordAudit(prisma, request, {
        action: 'operator.create', targetType: 'PlatformOperator', targetId: id,
      });
      return reply.status(201).send({ id, email: body.data.email, name: body.data.name, active: true });
    } catch (error) {
      if (error instanceof CreateOperatorError) {
        return error.code === 'duplicate'
          ? reply.status(409).send({ error: 'email_in_use', message: error.message })
          : reply.status(400).send({ error: 'bad_request', message: error.message });
      }
      throw error;
    }
  });

  scope.post<{ Params: { id: string } }>('/operators/:id/deactivate', { preHandler }, async (request, reply) => {
    const { id } = request.params;
    if (id === request.operator.id) {
      return reply.status(400).send({ error: 'cannot_deactivate_self', message: 'você não pode desativar a si mesmo' });
    }
    const target = await prisma.platformOperator.findUnique({ where: { id }, select: { id: true } });
    if (!target) return reply.status(404).send({ error: 'not_found', message: 'operador não encontrado' });
    await prisma.platformOperator.update({ where: { id }, data: { active: false } });
    await recordAudit(prisma, request, { action: 'operator.deactivate', targetType: 'PlatformOperator', targetId: id });
    return reply.send({ id, active: false });
  });
}

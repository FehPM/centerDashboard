import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../auth/password.js';
import type { AppDeps } from '../deps.js';
import { recordAudit } from './audit.js';
import { makeRequireOperator } from './auth/guard.js';

const CreateBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  temporaryPassword: z.string().min(12),
});
const ResetBody = z.object({ temporaryPassword: z.string().min(12) });

const EMAIL_IN_USE = { error: 'email_in_use', message: 'e-mail já cadastrado' };
const ORG_NOT_FOUND = { error: 'not_found', message: 'cliente não encontrado' };
const USER_NOT_FOUND = { error: 'not_found', message: 'usuário não encontrado' };

const userSelect = { id: true, name: true, email: true, role: true, active: true, mustChangePassword: true } as const;

export async function registerInternalUserRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma } = deps;
  const preHandler = makeRequireOperator(prisma);

  scope.get<{ Params: { id: string } }>('/organizations/:id/users', { preHandler }, async (request, reply) => {
    const org = await prisma.organization.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!org) return reply.status(404).send(ORG_NOT_FOUND);
    return prisma.user.findMany({
      where: { organizationId: org.id }, select: userSelect, orderBy: { createdAt: 'asc' },
    });
  });

  scope.post<{ Params: { id: string } }>('/organizations/:id/users', { preHandler }, async (request, reply) => {
    const body = CreateBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'bad_request', message: 'dados inválidos (senha provisória com no mínimo 12 caracteres)' });
    }
    const org = await prisma.organization.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!org) return reply.status(404).send(ORG_NOT_FOUND);
    // E-mail é único globalmente: a resposta nunca diz em qual cliente existe.
    if (await prisma.user.findUnique({ where: { email: body.data.email }, select: { id: true } })) {
      return reply.status(409).send(EMAIL_IN_USE);
    }
    let created;
    try {
      created = await prisma.user.create({
        data: {
          name: body.data.name, email: body.data.email, role: 'ADMIN', organizationId: org.id,
          passwordHash: await hashPassword(body.data.temporaryPassword), mustChangePassword: true, active: true,
        },
        select: userSelect,
      });
    } catch (error) {
      // Corrida entre dois cadastros com o mesmo e-mail.
      if ((error as { code?: string }).code === 'P2002') return reply.status(409).send(EMAIL_IN_USE);
      throw error;
    }
    await recordAudit(prisma, request, {
      action: 'user.create_admin', organizationId: org.id, targetType: 'User', targetId: created.id,
    });
    return reply.status(201).send(created);
  });

  scope.post<{ Params: { id: string } }>('/users/:id/deactivate', { preHandler }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id }, select: { id: true, organizationId: true },
    });
    if (!user) return reply.status(404).send(USER_NOT_FOUND);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    await recordAudit(prisma, request, {
      action: 'user.deactivate', organizationId: user.organizationId, targetType: 'User', targetId: user.id,
    });
    return reply.send({ id: user.id, active: false });
  });

  scope.post<{ Params: { id: string } }>('/users/:id/reset-password', { preHandler }, async (request, reply) => {
    const body = ResetBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'bad_request', message: 'senha provisória com no mínimo 12 caracteres' });
    }
    const user = await prisma.user.findUnique({
      where: { id: request.params.id }, select: { id: true, organizationId: true },
    });
    if (!user) return reply.status(404).send(USER_NOT_FOUND);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.data.temporaryPassword), mustChangePassword: true },
    });
    await recordAudit(prisma, request, {
      action: 'user.reset_password', organizationId: user.organizationId, targetType: 'User', targetId: user.id,
    });
    return reply.send({ id: user.id, mustChangePassword: true });
  });
}

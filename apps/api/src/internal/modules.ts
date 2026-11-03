import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isModuleKey } from '@center/entitlements';
import type { AppDeps } from '../deps.js';
import { recordAudit } from './audit.js';
import { makeRequireOperator } from './auth/guard.js';

const BodySchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/** Ativação manual de módulos por cliente (origin = MANUAL, cobrança fora do sistema). */
export async function registerModuleRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma } = deps;
  const preHandler = makeRequireOperator(prisma);

  scope.put<{ Params: { id: string; key: string } }>(
    '/organizations/:id/modules/:key', { preHandler }, async (request, reply) => {
      const { id, key } = request.params;
      if (!isModuleKey(key)) return reply.status(404).send({ error: 'not_found', message: 'módulo desconhecido' });
      const parsed = BodySchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'bad_request', message: 'status, startsAt ou endsAt inválidos' });
      const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
      if (!org) return reply.status(404).send({ error: 'not_found', message: 'cliente não encontrado' });

      const where = { organizationId_moduleKey: { organizationId: id, moduleKey: key } };
      const existing = await prisma.organizationModule.findUnique({ where });
      const startsAt = parsed.data.startsAt ? new Date(parsed.data.startsAt) : (existing?.startsAt ?? new Date());
      const endsAt = parsed.data.endsAt === undefined
        ? (existing?.endsAt ?? null)
        : (parsed.data.endsAt === null ? null : new Date(parsed.data.endsAt));
      if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
        return reply.status(400).send({ error: 'bad_request', message: 'endsAt deve ser posterior a startsAt' });
      }

      const data = { status: parsed.data.status, startsAt, endsAt, updatedByOperatorId: request.operator.id };
      const saved = await prisma.organizationModule.upsert({
        where,
        create: { organizationId: id, moduleKey: key, origin: 'MANUAL', ...data },
        update: data,
      });
      const suspended = parsed.data.status === 'SUSPENDED';
      const action = !existing
        ? (suspended ? 'module.suspend' : 'module.activate')
        : (suspended ? 'module.suspend' : 'module.update');
      await recordAudit(prisma, request, {
        action, organizationId: id, targetType: 'OrganizationModule', targetId: key,
        metadata: {
          moduleKey: key, status: parsed.data.status, startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() ?? null,
        },
      });
      return { key, status: saved.status, startsAt: saved.startsAt, endsAt: saved.endsAt };
    },
  );
}

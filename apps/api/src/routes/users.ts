import type { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { isModuleKey, type ModuleKey } from '@center/entitlements';
import { requireAdmin } from '../auth/jwt.js';
import { hashPassword } from '../auth/password.js';
import { getAccess } from '../authz/guards.js';
import type { AppDeps } from '../deps.js';

const TemporaryPassword = z.string().min(12);
const Modules = z.array(z.string());

const CreateBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER']),
  temporaryPassword: TemporaryPassword,
  modules: Modules,
});
const PatchBody = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'MEMBER']).optional(),
  active: z.boolean().optional(),
  modules: Modules.optional(),
});
const ResetBody = z.object({ temporaryPassword: TemporaryPassword });

const EMAIL_IN_USE = { error: 'email_in_use', message: 'e-mail já cadastrado' };
const NOT_FOUND = { error: 'not_found', message: 'usuário não encontrado' };
const LAST_ADMIN = { error: 'last_admin', message: 'a organização precisa de ao menos um administrador ativo' };

class HttpError extends Error {
  constructor(readonly status: number, readonly body: { error: string; message: string }) {
    super(body.message);
  }
}

const userSelect = {
  id: true, name: true, email: true, role: true, active: true, mustChangePassword: true,
  moduleAccess: { select: { moduleKey: true } },
} as const;

interface UserRow {
  id: string; name: string; email: string; role: 'ADMIN' | 'MEMBER'; active: boolean; mustChangePassword: boolean;
  moduleAccess: Array<{ moduleKey: string }>;
}

/**
 * Admin enxerga todos os módulos em vigor; Membro, só os que recebeu E que
 * estão em vigor (grants de módulo suspenso ficam dormentes no banco).
 */
function present(row: UserRow, adminModules: ModuleKey[]) {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role, active: row.active,
    mustChangePassword: row.mustChangePassword,
    modules: row.role === 'ADMIN'
      ? adminModules
      : row.moduleAccess.map((g) => g.moduleKey).filter((key) => (adminModules as string[]).includes(key)),
  };
}

export async function registerUserRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma } = deps;
  const preHandler = [app.authenticate, requireAdmin];

  const badRequest = (reply: FastifyReply, message: string) =>
    reply.status(400).send({ error: 'bad_request', message });

  /** Módulos precisam ser chaves válidas e contratos em vigor do cliente. */
  function invalidModule(modules: string[], inForce: ModuleKey[]): string | null {
    for (const key of modules) {
      if (!isModuleKey(key) || !inForce.includes(key)) return key;
    }
    return null;
  }

  app.get('/api/users', { preHandler }, async (request, reply) => {
    const access = await getAccess(request, prisma);
    const rows = await prisma.user.findMany({
      where: { organizationId: request.auth.organizationId },
      select: userSelect,
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(rows.map((row) => present(row as UserRow, access.modules)));
  });

  app.post('/api/users', { preHandler }, async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'dados inválidos (senha provisória com no mínimo 12 caracteres)');
    const body = parsed.data;
    const access = await getAccess(request, prisma);
    const bad = invalidModule(body.modules, access.modules);
    if (bad) return badRequest(reply, `módulo não contratado: ${bad}`);

    // E-mail é único globalmente: a resposta nunca diz em qual cliente existe.
    if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
      return reply.status(409).send(EMAIL_IN_USE);
    }
    const passwordHash = await hashPassword(body.temporaryPassword);
    const modules = [...new Set(body.modules)];
    try {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: body.name, email: body.email, role: body.role, passwordHash,
            organizationId: request.auth.organizationId, mustChangePassword: true, active: true,
          },
          select: { id: true },
        });
        await tx.userModuleAccess.createMany({
          data: modules.map((moduleKey) => ({ userId: user.id, moduleKey, grantedByUserId: request.auth.userId })),
        });
        return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: userSelect });
      });
      return reply.status(201).send(present(created as UserRow, access.modules));
    } catch (error) {
      // Corrida entre dois cadastros com o mesmo e-mail.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send(EMAIL_IN_USE);
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', { preHandler }, async (request, reply) => {
    const parsed = PatchBody.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'dados inválidos');
    const body = parsed.data;
    const { organizationId, userId } = request.auth;
    const targetId = request.params.id;
    if (body.active === false && targetId === userId) {
      return reply.status(400).send({ error: 'cannot_deactivate_self', message: 'você não pode desativar o próprio usuário' });
    }
    const access = await getAccess(request, prisma);
    if (body.modules) {
      const bad = invalidModule(body.modules, access.modules);
      if (bad) return badRequest(reply, `módulo não contratado: ${bad}`);
    }

    const MAX_ATTEMPTS = 3;
    try {
      // Conflito de serialização (P2034) em requisições concorrentes: repete a
      // transação; na nova tentativa a contagem é relida e vale o 409 normal.
      for (let attempt = 1; ; attempt++) {
        try {
          return await applyPatch();
        } catch (error) {
          const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
          if (!conflict || attempt >= MAX_ATTEMPTS) throw error;
        }
      }
    } catch (error) {
      if (error instanceof HttpError) return reply.status(error.status).send(error.body);
      throw error;
    }

    async function applyPatch() {
      // Serializable: a contagem de Admins ativos e a escrita não podem
      // intercalar com outra requisição que rebaixe/desative o outro Admin.
      const updated = await prisma.$transaction(async (tx) => {
        const target = await tx.user.findFirst({
          where: { id: targetId, organizationId },
          select: { id: true, role: true, active: true },
        });
        if (!target) throw new HttpError(404, NOT_FOUND);

        const losesAdmin = target.role === 'ADMIN' && target.active
          && (body.role === 'MEMBER' || body.active === false);
        if (losesAdmin) {
          const activeAdmins = await tx.user.count({ where: { organizationId, role: 'ADMIN', active: true } });
          if (activeAdmins <= 1) throw new HttpError(409, LAST_ADMIN);
        }

        const data: Prisma.UserUpdateInput = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.role !== undefined) data.role = body.role;
        if (body.active !== undefined) data.active = body.active;
        if (body.modules) {
          // Só substitui o que está em vigor: grants de módulo suspenso continuam no banco.
          await tx.userModuleAccess.deleteMany({
            where: { userId: targetId, moduleKey: { in: access.modules } },
          });
          await tx.userModuleAccess.createMany({
            data: [...new Set(body.modules)].map((moduleKey) => ({
              userId: targetId, moduleKey, grantedByUserId: userId,
            })),
            skipDuplicates: true,
          });
        }
        return tx.user.update({ where: { id: targetId }, data, select: userSelect });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return reply.send(present(updated as UserRow, access.modules));
    }
  });

  app.post<{ Params: { id: string } }>(
    '/api/users/:id/reset-password',
    { preHandler },
    async (request, reply) => {
      const parsed = ResetBody.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, 'senha provisória com no mínimo 12 caracteres');
      const { organizationId } = request.auth;
      const target = await prisma.user.findFirst({
        where: { id: request.params.id, organizationId },
        select: { id: true },
      });
      if (!target) return reply.status(404).send(NOT_FOUND);
      await prisma.user.update({
        where: { id: target.id },
        data: { passwordHash: await hashPassword(parsed.data.temporaryPassword), mustChangePassword: true },
      });
      return reply.status(204).send();
    },
  );
}

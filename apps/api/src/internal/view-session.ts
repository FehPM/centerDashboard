import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps.js';
import { recordAudit } from './audit.js';
import { makeRequireOperator } from './auth/guard.js';

const VIEW_SESSION_MINUTES = 30;

/** Sessão de visualização: token de cliente somente leitura, emitido para o operador. */
export async function registerViewSessionRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma, config } = deps;
  const preHandler = makeRequireOperator(prisma);

  scope.post('/organizations/:id/view-session', { preHandler }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const organization = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!organization) {
      return reply.status(404).send({ error: 'not_found', message: 'cliente não encontrado' });
    }

    // `scope.jwt` é o assinador de cliente (raiz); o do operador fica em `jwt.operator`.
    // Opções locais substituem os padrões registrados, então `aud` vai explícito.
    const token = scope.jwt.sign(
      { userId: `operator:${request.operator.id}`, organizationId: id, role: 'ADMIN', viewedBy: request.operator.id },
      { expiresIn: `${VIEW_SESSION_MINUTES}m`, aud: 'client' } as never,
    );
    const expiresAt = new Date(Date.now() + VIEW_SESSION_MINUTES * 60_000).toISOString();

    // Auditado mesmo com o cliente suspenso: o painel responderá organization_suspended.
    await recordAudit(prisma, request, { action: 'view_session.start', organizationId: id });
    return { token, url: `${config.panelOrigin}/view-session#${token}`, expiresAt };
  });
}

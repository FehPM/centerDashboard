import type { PrismaClient } from '@prisma/client';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { OperatorPayload } from '../plugin.js';

/** Exige token de operador no estágio `session` e operador ainda ativo (lido do banco). */
export function makeRequireOperator(prisma: PrismaClient): preHandlerAsyncHookHandler {
  return async function requireOperator(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const deny = () => reply.status(401).send({ error: 'unauthorized', message: 'token ausente ou inválido' });
    let decoded: OperatorPayload;
    try {
      decoded = await request.operatorJwtVerify<OperatorPayload>();
    } catch {
      await deny();
      return;
    }
    if (decoded.stage !== 'session') {
      await deny();
      return;
    }
    const operator = await prisma.platformOperator.findUnique({
      where: { id: decoded.operatorId },
      select: { id: true, email: true, name: true, active: true },
    });
    if (!operator || !operator.active) {
      await deny();
      return;
    }
    request.operator = { id: operator.id, email: operator.email, name: operator.name };
  };
}

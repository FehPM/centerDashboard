import type { FastifyReply, FastifyRequest } from 'fastify';
import '../authz/principal.js';

export interface AuthPayload {
  userId: string;
  organizationId: string;
  role: 'ADMIN' | 'MEMBER';
  /** Presente só em sessão de visualização de operador. */
  viewedBy?: string;
  /** Emitido em (segundos). Ver `issuedAtFor`. */
  iat?: number;
}

/**
 * `iat` (segundos) para um token novo do usuário.
 *
 * `app.authenticate` recusa token com `iat * 1000 < passwordChangedAt`. O
 * `iat` do JWT tem resolução de segundo, então um token emitido no mesmo
 * segundo da troca, mas depois dela, teria `iat` "anterior" e seria recusado.
 * Arredondar para cima a hora da troca resolve: o token novo nunca é
 * anterior a ela, e todo token emitido antes da troca continua sendo.
 */
export function issuedAtFor(passwordChangedAt: Date | null | undefined, now: number = Date.now()): number {
  const nowSeconds = Math.floor(now / 1000);
  if (!passwordChangedAt) return nowSeconds;
  return Math.max(nowSeconds, Math.ceil(passwordChangedAt.getTime() / 1000));
}

/** Token emitido antes da última troca/redefinição de senha: não vale mais. */
export function issuedBeforePasswordChange(iat: number | undefined, passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false;
  // Sem iat não há como provar que o token é posterior: recusa.
  if (typeof iat !== 'number') return true;
  return iat * 1000 < passwordChangedAt.getTime();
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthPayload;
    user: AuthPayload;
  }
}

/** Roda depois de `app.authenticate`. Barra qualquer papel que não seja ADMIN. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.auth.role !== 'ADMIN') {
    await reply.status(403).send({ error: 'forbidden', message: 'requer papel de administrador' });
  }
}

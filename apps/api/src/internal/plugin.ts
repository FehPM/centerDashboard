import type { FastifyInstance } from 'fastify';
import jwt, { type JWT, type VerifyOptions } from '@fastify/jwt';
import type { AppDeps } from '../deps.js';
import { registerOperatorAuthRoutes } from './auth/routes.js';

export interface OperatorPayload { operatorId: string; stage: 'enroll' | 'mfa' | 'session' }

declare module 'fastify' {
  interface FastifyRequest {
    operator: { id: string; email: string; name: string };
    /** Verifica o token do operador (jwt registrado com `namespace: 'operator'`). */
    operatorJwtVerify<T = OperatorPayload>(options?: Partial<VerifyOptions>): Promise<T>;
  }
}

/** O namespace `operator` do @fastify/jwt não aparece nos tipos de `app.jwt`. */
export function operatorJwt(scope: FastifyInstance): JWT {
  return (scope.jwt as unknown as { operator: JWT }).operator;
}

/** Mundo do operador: `/internal/*`, JWT próprio (`aud = "operator"`, segredo próprio). */
export async function registerInternal(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(async (scope) => {
    await scope.register(jwt, {
      secret: deps.config.operatorJwtSecret,
      namespace: 'operator',
      jwtVerify: 'operatorJwtVerify',
      jwtSign: 'operatorJwtSign',
      sign: { aud: 'operator' },
      // fast-jwt ignora allowedAud quando o claim falta; requiredClaims exige a presença.
      verify: { allowedAud: 'operator', requiredClaims: ['aud'] },
    });
    await registerOperatorAuthRoutes(scope, deps);
  }, { prefix: '/internal' });
}

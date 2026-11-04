import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DUMMY_HASH, verifyPassword } from '../../auth/password.js';
import type { AppDeps } from '../../deps.js';
import { recordAudit } from '../audit.js';
import { operatorJwt, type OperatorPayload } from '../plugin.js';
import { makeRequireOperator } from './guard.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

const LoginBodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const TotpBodySchema = z.object({ token: z.string().min(1), code: z.string().regex(/^\d{6}$/) });

const RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
const MAX_TOTP_FAILURES = 5;
const TOTP_LOCK_MS = 15 * 60 * 1000;
const unauthorized = { error: 'unauthorized', message: 'credenciais inválidas' };

export async function registerOperatorAuthRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const requireOperator = makeRequireOperator(deps.prisma);
  // aud explícito: o @fastify/jwt não mescla o `sign` registrado quando há opções locais.
  const signToken = (payload: OperatorPayload, expiresIn: string): string =>
    operatorJwt(scope).sign(payload as never, { expiresIn, aud: 'operator' } as never);

  scope.post('/auth/login', RATE_LIMIT, async (request, reply) => {
    const parsed = LoginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad_request', message: 'email e password são obrigatórios' });
    }
    const operator = await deps.prisma.platformOperator.findUnique({ where: { email: parsed.data.email } });
    // Mesmo custo de scrypt e mesma resposta para inexistente, inativo e senha errada.
    const valid = await verifyPassword(parsed.data.password, operator?.passwordHash ?? DUMMY_HASH);
    if (!operator || !operator.active || !valid) return reply.status(401).send(unauthorized);

    if (!operator.totpEnabledAt) {
      // Cadastro do TOTP: o segredo pendente é substituído a cada login até a confirmação.
      const secret = generateTotpSecret();
      await deps.prisma.platformOperator.update({
        where: { id: operator.id }, data: { totpSecret: deps.secretBox.encrypt(secret) },
      });
      return reply.send({
        stage: 'enroll',
        token: signToken({ operatorId: operator.id, stage: 'enroll' }, '10m'),
        otpauthUri: totpUri(operator.email, secret),
        secret,
      });
    }
    return reply.send({ stage: 'mfa', token: signToken({ operatorId: operator.id, stage: 'mfa' }, '5m') });
  });

  scope.post('/auth/totp', RATE_LIMIT, async (request, reply) => {
    const parsed = TotpBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad_request', message: 'token e code são obrigatórios' });
    }
    let decoded: OperatorPayload;
    try {
      decoded = operatorJwt(scope).verify<OperatorPayload>(parsed.data.token);
    } catch {
      return reply.status(401).send(unauthorized);
    }
    if (decoded.stage !== 'enroll' && decoded.stage !== 'mfa') return reply.status(401).send(unauthorized);

    const operator = await deps.prisma.platformOperator.findUnique({ where: { id: decoded.operatorId } });
    // Estágio precisa bater com o estado real: enroll só sem TOTP ativo, mfa só com.
    const stageMatches = decoded.stage === 'enroll' ? !operator?.totpEnabledAt : !!operator?.totpEnabledAt;
    if (!operator || !operator.active || !operator.totpSecret || !stageMatches) {
      return reply.status(401).send(unauthorized);
    }
    const now = new Date();
    // Bloqueio por operador: nem um código válido é aceito enquanto estiver bloqueado.
    if (operator.totpLockedUntil && operator.totpLockedUntil > now) {
      return reply.status(429).send({
        error: 'too_many_attempts', message: 'muitas tentativas; tente novamente em alguns minutos',
      });
    }
    if (!verifyTotp(parsed.data.code, deps.secretBox.decrypt(operator.totpSecret))) {
      // Incremento atômico: tentativas concorrentes não escapam da contagem.
      const updated = await deps.prisma.platformOperator.update({
        where: { id: operator.id },
        data: { failedTotpAttempts: { increment: 1 } },
        select: { failedTotpAttempts: true },
      });
      if (updated.failedTotpAttempts >= MAX_TOTP_FAILURES) {
        await deps.prisma.platformOperator.update({
          where: { id: operator.id },
          data: { totpLockedUntil: new Date(now.getTime() + TOTP_LOCK_MS), failedTotpAttempts: 0 },
        });
      }
      return reply.status(401).send(unauthorized);
    }

    const reset = { failedTotpAttempts: 0, totpLockedUntil: null, lastLoginAt: now };
    await deps.prisma.platformOperator.update({
      where: { id: operator.id },
      data: decoded.stage === 'enroll' ? { ...reset, totpEnabledAt: now } : reset,
    });
    request.operator = { id: operator.id, email: operator.email, name: operator.name };
    await recordAudit(deps.prisma, request, {
      action: 'operator.login', targetType: 'PlatformOperator', targetId: operator.id,
    });
    return reply.send({
      token: signToken({ operatorId: operator.id, stage: 'session' }, '8h'),
      operator: { id: operator.id, name: operator.name, email: operator.email },
    });
  });

  scope.get('/auth/me', { preHandler: requireOperator }, async (request) => ({ operator: request.operator }));
}

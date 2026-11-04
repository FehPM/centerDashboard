import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getModule, isSourceReady, moduleReadiness } from '@center/entitlements';
import { getAccess } from '../authz/guards.js';
import type { AppDeps } from '../deps.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import { issuedAtFor, type AuthPayload } from './jwt.js';

const PasswordBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});

const LoginBodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post(
    '/auth/login',
    // Força bruta é o risco real desta rota; o limite global de 300/min não basta.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = LoginBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'bad_request', message: 'email e password são obrigatórios' });
      }

      const user = await deps.prisma.user.findUnique({ where: { email: parsed.data.email } });
      // Mesma resposta e o mesmo custo de scrypt para email inexistente e
      // senha errada: sem enumeração por corpo de resposta nem por timing.
      const passwordHash = user?.passwordHash ?? DUMMY_HASH;
      const valid = await verifyPassword(parsed.data.password, passwordHash);
      // Usuário desativado cai no mesmo 401 de senha errada (sem enumeração).
      if (!user || !user.active || !valid) {
        return reply.status(401).send({ error: 'unauthorized', message: 'credenciais inválidas' });
      }

      // Só após a senha correta: quem acertou a senha pode saber que o cliente está suspenso.
      const organization = await deps.prisma.organization.findUnique({
        where: { id: user.organizationId }, select: { status: true },
      });
      if (organization?.status !== 'ACTIVE') {
        return reply.status(403).send({ error: 'organization_suspended', message: 'cliente suspenso' });
      }

      const payload: AuthPayload = {
        userId: user.id, organizationId: user.organizationId, role: user.role,
        // `iat` nunca anterior à última troca de senha (ver issuedAtFor).
        iat: issuedAtFor(user.passwordChangedAt),
      };
      return reply.send({
        // aud explícito: o @fastify/jwt não mescla o `sign` global quando há opções locais.
        token: app.jwt.sign(payload, { expiresIn: '12h', aud: 'client' }),
        user: {
          id: user.id, name: user.name, email: user.email, role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
      });
    },
  );

  app.post(
    '/auth/password',
    {
      preHandler: app.authenticate,
      config: { allowDuringPasswordChange: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = PasswordBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'bad_request', message: 'newPassword deve ter ao menos 12 caracteres' });
      }
      const user = await deps.prisma.user.findUnique({
        where: { id: request.auth.userId }, select: { passwordHash: true },
      });
      if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
        return reply.status(401).send({ error: 'unauthorized', message: 'senha atual incorreta' });
      }
      // Vale também para a troca obrigatória: repetir a senha provisória
      // deixaria quem a definiu (Admin ou Blan) sabendo a senha do usuário.
      if (parsed.data.newPassword === parsed.data.currentPassword) {
        return reply.status(400).send({
          error: 'bad_request', message: 'a nova senha precisa ser diferente da senha atual',
        });
      }
      // passwordChangedAt derruba todo token emitido antes (app.authenticate).
      const passwordChangedAt = new Date();
      await deps.prisma.user.update({
        where: { id: request.auth.userId },
        data: {
          passwordHash: await hashPassword(parsed.data.newPassword),
          mustChangePassword: false,
          passwordChangedAt,
        },
      });
      // Token novo na mesma resposta: quem acabou de trocar a senha continua
      // logado nesta aba; as outras sessões caem no 401.
      const payload: AuthPayload = {
        userId: request.auth.userId, organizationId: request.auth.organizationId, role: request.auth.role,
        iat: issuedAtFor(passwordChangedAt),
      };
      return reply.send({ token: app.jwt.sign(payload, { expiresIn: '12h', aud: 'client' }) });
    },
  );

  app.get(
    '/auth/me',
    { preHandler: app.authenticate, config: { readonlySafe: true, allowDuringPasswordChange: true } },
    async (request, reply) => {
      const auth = request.auth;
      const viewSession = auth.viewedBy !== null;
      const [access, user, organization] = await Promise.all([
        getAccess(request, deps.prisma),
        viewSession
          ? Promise.resolve(null)
          : deps.prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } }),
        deps.prisma.organization.findUnique({ where: { id: auth.organizationId }, select: { id: true, name: true } }),
      ]);
      if (!organization || (!viewSession && !user)) {
        return reply.status(401).send({ error: 'unauthorized', message: 'token ausente ou inválido' });
      }
      // Status do sync em leitura, para o aviso "dados atualizados até…" nos
      // módulos de commerce. Nunca a mensagem de erro: só se a última
      // tentativa falhou (o detalhe fica com a Blan, no back-office).
      const commerceState = access.sources.has('commerce')
        ? await deps.prisma.syncState.findUnique({
            where: { organizationId_resource: { organizationId: auth.organizationId, resource: 'orders' } },
            select: { lastSyncedAt: true, lastError: true },
          })
        : null;
      const sources = [...access.sources];
      return {
        user: user
          ? { id: auth.userId, name: user.name, email: user.email, role: auth.role, mustChangePassword: auth.mustChangePassword }
          : { id: auth.userId, name: 'Equipe Blan (visualização)', email: '', role: 'ADMIN', mustChangePassword: false },
        organization: { id: organization.id, name: organization.name },
        modules: access.modules.map((key) => {
          const { label, menuPath } = getModule(key);
          return { key, label, menuPath, state: moduleReadiness(key, access.integrations) };
        }),
        sources,
        // Liberadas E prontas: só destas o painel pede dados. Uma fonte
        // liberada e ainda pendente responderia 409 e derrubaria o lote todo.
        readySources: sources.filter((source) => isSourceReady(source, access.integrations)),
        commerceSync: commerceState
          ? {
              lastSyncedAt: commerceState.lastSyncedAt?.toISOString() ?? null,
              lastAttemptFailed: commerceState.lastError !== null,
            }
          : null,
        viewSession,
      };
    },
  );
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GranularitySchema, IsoDateSchema } from '@center/shared';
import { decideSource, type SourceDecision } from '@center/entitlements';
import { correlateMetrics, sourceOf } from '@center/mcp-core';
import { getAccess, replyForDecision, requireModule } from '../authz/guards.js';
import { resolveTenant } from '../tenant.js';
import { analyzeAppVersionImpact } from '../analysis/app-version-impact.js';
import { scopeGateway } from '../authz/scoped-gateway.js';
import type { AccessContext } from '../authz/access.js';
import type { MetricSource } from '@center/shared';
import { badRequest, upstreamError } from './metrics.js';
import { assertRange, BadRequestError } from '../range.js';
import type { AppDeps } from '../deps.js';

const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

const CorrelateBodySchema = z.object({
  metricIdA: z.string().min(1),
  metricIdB: z.string().min(1),
  from: IsoDateSchema,
  to: IsoDateSchema,
  granularity: GranularitySchema,
});

const VersionImpactBodySchema = z.object({
  version: z.string().min(1),
  releaseDate: IsoDateSchema,
  windowDays: z.number().int().min(3).max(90).optional(),
});

/** forbidden vence pending; devolve a pior decisão entre as fontes. */
function worstDecision(sources: MetricSource[], access: AccessContext): SourceDecision {
  const decisions = sources.map((s) => decideSource(s, access.modules, access.integrations));
  return decisions.includes('forbidden') ? 'forbidden' : decisions.includes('pending') ? 'pending' : 'allowed';
}

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIME_ZONE });
}

export async function registerAnalysisRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/analysis/correlate', { preHandler: app.authenticate, config: { readonlySafe: true } }, async (request, reply) => {
    const parsed = CorrelateBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message ?? 'corpo inválido');

    let sources: MetricSource[];
    try {
      sources = [sourceOf(parsed.data.metricIdA), sourceOf(parsed.data.metricIdB)];
    } catch (error) {
      return badRequest(reply, error instanceof Error ? error.message : 'metricId inválido');
    }
    // Fora do try acima: falha de banco não pode virar 400 com mensagem interna.
    const access = await getAccess(request, deps.prisma);
    const refusal = replyForDecision(reply, worstDecision(sources, access));
    if (refusal) return refusal;

    try {
      assertRange(parsed.data);
      const tenant = await resolveTenant(deps.prisma, request.auth.organizationId);
      return reply.send(await correlateMetrics(scopeGateway(deps.gateway, access.sources), { ...parsed.data, tenant }));
    } catch (error) {
      if (error instanceof BadRequestError) return badRequest(reply, error.message);
      // "métrica com ela mesma" é erro do cliente, não da fonte.
      if (error instanceof Error && error.message.includes('ela mesma')) {
        return badRequest(reply, error.message);
      }
      return upstreamError(reply, error);
    }
  });

  app.post('/api/analysis/app-version-impact',
    { preHandler: [app.authenticate, requireModule('app_usage', deps.prisma)], config: { readonlySafe: true } }, async (request, reply) => {
    const parsed = VersionImpactBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message ?? 'corpo inválido');

    // O módulo app_usage só libera firebase, mas a análise também lê commerce e ga4.
    const access = await getAccess(request, deps.prisma);
    const refusal = replyForDecision(reply, worstDecision(['commerce', 'ga4'], access));
    if (refusal) return refusal;

    try {
      const tenant = await resolveTenant(deps.prisma, request.auth.organizationId);
      return reply.send(await analyzeAppVersionImpact({
        gateway: scopeGateway(deps.gateway, access.sources), tenant, today: today(), ...parsed.data,
      }));
    } catch (error) {
      if (error instanceof Error && error.message.includes('futuro')) {
        return badRequest(reply, error.message);
      }
      return upstreamError(reply, error);
    }
  });
}

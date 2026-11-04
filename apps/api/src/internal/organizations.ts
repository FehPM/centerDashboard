import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MODULE_KEYS, isContractInForce, moduleReadiness, type ModuleKey } from '@center/entitlements';
import type { AppDeps } from '../deps.js';
import { loadIntegrationStates } from '../integrations/repository.js';
import { slugify } from '../lib/slug.js';
import { recordAudit } from './audit.js';
import { makeRequireOperator } from './auth/guard.js';

const CreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60).optional(),
});
const PatchBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
}).refine((b) => b.name !== undefined || b.status !== undefined);

const notFound = { error: 'not_found', message: 'cliente não encontrado' };
const slugInUse = { error: 'slug_in_use', message: 'já existe um cliente com esse slug' };

interface OrgRow {
  id: string; name: string; slug: string | null; status: 'ACTIVE' | 'SUSPENDED'; createdAt: Date;
  modules: Array<{ moduleKey: string; status: 'ACTIVE' | 'SUSPENDED'; startsAt: Date; endsAt: Date | null }>;
}

const MODULES_SELECT = { select: { moduleKey: true, status: true, startsAt: true, endsAt: true } };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

export async function registerOrganizationRoutes(scope: FastifyInstance, deps: AppDeps): Promise<void> {
  const { prisma, config } = deps;
  const preHandler = makeRequireOperator(prisma);

  // Módulos ordenados pelo catálogo; `pendingSetup` = em vigor mas com integração faltando.
  async function present(org: OrgRow) {
    const now = new Date();
    const integrations = await loadIntegrationStates(prisma, org.id);
    const byKey = new Map(org.modules.map((m) => [m.moduleKey, m]));
    const modules = MODULE_KEYS.flatMap((key) => {
      const m = byKey.get(key);
      return m ? [{ key, status: m.status, startsAt: m.startsAt, endsAt: m.endsAt, inForce: isContractInForce(m, now) }] : [];
    });
    const pendingSetup: ModuleKey[] = modules
      .filter((m) => m.inForce && moduleReadiness(m.key, integrations) === 'awaiting_setup')
      .map((m) => m.key);
    return { id: org.id, name: org.name, slug: org.slug, status: org.status, createdAt: org.createdAt, modules, pendingSetup };
  }

  scope.get('/organizations', { preHandler }, async () => {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, slug: true, status: true, createdAt: true, modules: MODULES_SELECT },
    });
    return Promise.all(orgs.map((org) => present(org as OrgRow)));
  });

  scope.post('/organizations', { preHandler }, async (request, reply) => {
    const parsed = CreateBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'bad_request', message: 'nome ou slug inválido' });
    const slug = parsed.data.slug ?? slugify(parsed.data.name);
    if (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
      return reply.status(409).send(slugInUse);
    }
    let created;
    try {
      created = await prisma.organization.create({
        data: { name: parsed.data.name, slug },
        select: { id: true, name: true, slug: true, status: true, createdAt: true, modules: MODULES_SELECT },
      });
    } catch (error) {
      // Corrida entre a checagem acima e o insert: a unicidade do banco decide.
      if (isUniqueViolation(error)) return reply.status(409).send(slugInUse);
      throw error;
    }
    await recordAudit(prisma, request, {
      action: 'organization.create', organizationId: created.id, targetType: 'Organization', targetId: created.id,
      metadata: { name: created.name, slug },
    });
    return reply.status(201).send(await present(created as OrgRow));
  });

  scope.get<{ Params: { id: string } }>('/organizations/:id', { preHandler }, async (request, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: request.params.id },
      select: {
        id: true, name: true, slug: true, status: true, createdAt: true, modules: MODULES_SELECT,
        _count: { select: { users: true } },
      },
    });
    if (!org) return reply.status(404).send(notFound);
    return {
      ...(await present(org as OrgRow)),
      usersCount: org._count.users,
      attribution: { organizationId: org.id, apiUrl: config.panelOrigin },
    };
  });

  scope.patch<{ Params: { id: string } }>('/organizations/:id', { preHandler }, async (request, reply) => {
    const parsed = PatchBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'bad_request', message: 'informe name ou status válidos' });
    const current = await prisma.organization.findUnique({
      where: { id: request.params.id }, select: { id: true, status: true },
    });
    if (!current) return reply.status(404).send(notFound);
    const updated = await prisma.organization.update({
      where: { id: current.id },
      data: { name: parsed.data.name, status: parsed.data.status },
      select: { id: true, name: true, slug: true, status: true, createdAt: true, modules: MODULES_SELECT },
    });
    const next = parsed.data.status;
    const action = next && next !== current.status
      ? (next === 'SUSPENDED' ? 'organization.suspend' : 'organization.reactivate')
      : 'organization.update';
    await recordAudit(prisma, request, {
      action, organizationId: current.id, targetType: 'Organization', targetId: current.id,
      metadata: { name: parsed.data.name, status: next },
    });
    return present(updated as OrgRow);
  });
}

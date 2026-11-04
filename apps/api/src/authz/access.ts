import type { PrismaClient } from '@prisma/client';
import type { MetricSource } from '@center/shared';
import { allowedSources, visibleModules, type IntegrationState, type ModuleKey } from '@center/entitlements';
import { loadIntegrationStates } from '../integrations/repository.js';
import type { Principal } from './principal.js';

export interface AccessContext {
  organizationId: string;
  role: 'ADMIN' | 'MEMBER';
  modules: ModuleKey[];
  sources: Set<MetricSource>;
  integrations: IntegrationState[];
}

/** Calcula, a partir do banco, o que o usuário pode ver agora (contratos, grants e integrações). */
export async function loadAccess(prisma: PrismaClient, principal: Principal, now: Date): Promise<AccessContext> {
  const viewSession = principal.viewedBy !== null;
  const role = viewSession ? 'ADMIN' : principal.role;
  const [contracts, grantRows, integrations] = await Promise.all([
    prisma.organizationModule.findMany({
      where: { organizationId: principal.organizationId },
      select: { moduleKey: true, status: true, startsAt: true, endsAt: true },
    }),
    !viewSession && role === 'MEMBER'
      ? prisma.userModuleAccess.findMany({ where: { userId: principal.userId }, select: { moduleKey: true } })
      : Promise.resolve([] as Array<{ moduleKey: string }>),
    loadIntegrationStates(prisma, principal.organizationId),
  ]);
  const modules = visibleModules({
    organizationActive: true, // auth.authenticate já recusou cliente suspenso
    role,
    contracts,
    grants: grantRows.map((g) => g.moduleKey),
    now,
  });
  return { organizationId: principal.organizationId, role, modules, sources: allowedSources(modules), integrations };
}

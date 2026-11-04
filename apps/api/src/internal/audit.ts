import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import './plugin.js';

export type AuditAction =
  | 'operator.login' | 'operator.create' | 'operator.deactivate'
  | 'organization.create' | 'organization.update' | 'organization.suspend' | 'organization.reactivate'
  | 'module.activate' | 'module.update' | 'module.suspend'
  | 'integration.upsert' | 'integration.check' | 'integration.disable'
  | 'user.create_admin' | 'user.deactivate' | 'user.reset_password'
  | 'view_session.start';

// Chaves que parecem segredo nunca vão para a auditoria (invariante 5). Exceção: flag
// booleana (ex.: `secretsChanged: true`) não carrega valor secreto e é útil na trilha.
const SENSITIVE_KEY = /secret|password|apikey|token|credential/i;

export async function recordAudit(
  prisma: PrismaClient,
  request: FastifyRequest,
  entry: {
    action: AuditAction; organizationId?: string; targetType?: string; targetId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const metadata = Object.fromEntries(
    Object.entries(entry.metadata ?? {}).filter(([key, value]) => typeof value === 'boolean' || !SENSITIVE_KEY.test(key)),
  );
  await prisma.operatorAuditLog.create({
    data: {
      operatorId: request.operator.id,
      action: entry.action,
      organizationId: entry.organizationId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: metadata as never,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    },
  });
}

import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { recordAudit } from '../internal/audit.js';

describe('recordAudit', () => {
  it('drops secret-looking metadata keys', async () => {
    const create = jest.fn(async () => ({}));
    const prisma = { operatorAuditLog: { create } } as unknown as PrismaClient;
    const request = {
      operator: { id: 'op_1' }, ip: '1.2.3.4', headers: { 'user-agent': 'jest' },
    } as unknown as FastifyRequest;

    await recordAudit(prisma, request, {
      action: 'integration.upsert', organizationId: 'org_1',
      metadata: { kind: 'COMMERCE', apiKey: 'x', secretsChanged: true },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operatorId: 'op_1', action: 'integration.upsert', organizationId: 'org_1',
        ip: '1.2.3.4', userAgent: 'jest',
        metadata: { kind: 'COMMERCE', secretsChanged: true },
      }),
    });
  });
});

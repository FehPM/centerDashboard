import type { PrismaClient } from '@prisma/client';
import { createOperator } from '../lib/create-operator.js';

function fakePrisma(existing: boolean) {
  const create = jest.fn(async () => ({ id: 'op_1' }));
  const prisma = {
    platformOperator: {
      findUnique: jest.fn(async () => (existing ? { id: 'op_0' } : null)),
      create,
    },
  } as unknown as PrismaClient;
  return { prisma, create };
}

describe('createOperator', () => {
  it('creates an operator with a hashed password', async () => {
    const { prisma, create } = fakePrisma(false);
    await expect(createOperator(prisma, { email: 'a@blan.com', name: 'A', password: 'senha-longa-123' }))
      .resolves.toEqual({ id: 'op_1' });
    const data = (create.mock.calls[0] as unknown as [{ data: { passwordHash: string } }])[0].data;
    expect(data.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('refuses a password shorter than 12', async () => {
    const { prisma, create } = fakePrisma(false);
    await expect(createOperator(prisma, { email: 'a@blan.com', name: 'A', password: 'curta-123' })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a duplicate email', async () => {
    const { prisma, create } = fakePrisma(true);
    await expect(createOperator(prisma, { email: 'a@blan.com', name: 'A', password: 'senha-longa-123' })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});

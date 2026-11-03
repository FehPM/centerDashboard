import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../../src/auth/password.js';

const InputSchema = z.object({
  email: z.string().email('e-mail inválido'),
  name: z.string().min(1, 'nome é obrigatório'),
  password: z.string().min(12, 'a senha precisa de ao menos 12 caracteres'),
});

export async function createOperator(
  prisma: Pick<PrismaClient, 'platformOperator'>,
  input: { email: string; name: string; password: string },
): Promise<{ id: string }> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`operador inválido — ${details}`);
  }
  const existing = await prisma.platformOperator.findUnique({ where: { email: parsed.data.email } });
  if (existing) throw new Error('já existe um operador com este e-mail');
  const created = await prisma.platformOperator.create({
    data: {
      email: parsed.data.email, name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
    },
    select: { id: true },
  });
  return { id: created.id };
}

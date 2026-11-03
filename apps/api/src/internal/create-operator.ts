import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../auth/password.js';

const InputSchema = z.object({
  email: z.string().email('e-mail inválido'),
  name: z.string().min(1, 'nome é obrigatório'),
  password: z.string().min(12, 'a senha precisa de ao menos 12 caracteres'),
});

/** `invalid`: dados fora das regras; `duplicate`: e-mail já cadastrado. */
export class CreateOperatorError extends Error {
  constructor(readonly code: 'invalid' | 'duplicate', message: string) {
    super(message);
  }
}

export async function createOperator(
  prisma: Pick<PrismaClient, 'platformOperator'>,
  input: { email: string; name: string; password: string },
): Promise<{ id: string }> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new CreateOperatorError('invalid', `operador inválido — ${details}`);
  }
  const existing = await prisma.platformOperator.findUnique({ where: { email: parsed.data.email } });
  if (existing) throw new CreateOperatorError('duplicate', 'já existe um operador com este e-mail');
  const created = await prisma.platformOperator.create({
    data: {
      email: parsed.data.email, name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
    },
    select: { id: true },
  });
  return { id: created.id };
}

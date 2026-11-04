import { PrismaClient } from '@prisma/client';
import { createOperator } from './lib/create-operator.js';

const prisma = new PrismaClient();

try {
  const { id } = await createOperator(prisma, {
    email: process.env.OPERATOR_EMAIL ?? '',
    name: process.env.OPERATOR_NAME ?? '',
    password: process.env.OPERATOR_PASSWORD ?? '',
  });
  console.log(`operador ${id} criado — o TOTP é cadastrado no primeiro login.`);
} catch (error) {
  console.error(`recusado: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

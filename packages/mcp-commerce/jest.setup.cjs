// Os testes deste pacote batem num Postgres real via Prisma.
//
// 1. Carrega o .env da raiz só para variáveis que ainda NÃO estão no ambiente
//    (o dotenv nunca sobrescreve process.env). No CI não há .env e o
//    DATABASE_URL vem do workflow; localmente, exporte o DATABASE_URL do banco
//    de teste antes de `pnpm test` (o turbo.json repassa DATABASE_URL e
//    REDIS_URL para a tarefa `test`).
// 2. Recusa rodar se o banco não for de teste (nome terminado em `_test`):
//    o .env de dev aponta para `center`, e a suíte criaria clientes
//    `org_test_*` nele.
const path = require('node:path');
const dotenv = require('dotenv');
const { assertTestDatabase } = require('../../jest.db-guard.cjs');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
assertTestDatabase(process.env.DATABASE_URL);

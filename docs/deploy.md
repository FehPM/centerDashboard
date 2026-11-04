# Deploy

A arquitetura é multi-tenant e modular ([design](superpowers/specs/2026-10-29-multi-tenant-modular-design.md)).
O compose de produção sobe:

- `api`: Fastify, atende `/api/*` (cliente) e `/internal/*` (operador), serve o
  painel do cliente compilado e roda `prisma migrate deploy` antes de iniciar;
- `sync`: worker de sincronização dos conectores de e-commerce;
- `backoffice`: container estático (nginx) com o console da Blan, em
  `admin.<domínio>`, que chama a API pela URL absoluta;
- `postgres` e `redis`;
- `whatsapp`: só com `--profile whatsapp` (fora do MVP).

Variáveis específicas desta arquitetura: `OPERATOR_JWT_SECRET` (segredo dos
tokens de operador, 32+ caracteres e diferente de `JWT_SECRET`),
`PANEL_ORIGIN` e `BACKOFFICE_ORIGIN` (CORS; precisam bater com as URLs públicas
do painel e do back-office), `MONDAY_API_TOKEN` (global da Blan),
`BACKOFFICE_API_URL` (build do back-office), `API_BIND`/`BACKOFFICE_BIND` e
`ENV_FILE`. As `WHATSAPP_*` são opcionais.

## Staging

```bash
cp .env.example .env   # preencha TODOS os valores; a API não sobe com env faltando
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api
```

**Sobre o `.env` usado com `docker-compose.prod.yml`:** preencha também
`POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` — eles inicializam o container
do Postgres. Em staging/produção reais, use valores gerados, não o `center`/`center`
do exemplo local. Os campos `DATABASE_URL`/`REDIS_URL` do mesmo `.env` continuam
preenchidos (são usados por `docker-compose.yml`, o compose de desenvolvimento local,
onde as portas do Postgres/Redis são publicadas no host e `localhost` funciona), mas
dentro dos containers `api`/`sync` (e `whatsapp`, se ligado) deste compose de produção eles são
**sobrescritos** por um bloco `environment:` que aponta para `postgres:5432` e
`redis:6379` — os nomes de serviço na rede interna do Compose, os únicos endereços
que os containeres irmãos realmente enxergam. Isso evita depender de manter dois
valores diferentes de `DATABASE_URL`/`REDIS_URL` no mesmo arquivo `.env` para os dois
cenários (local vs. este compose).

O serviço `api` roda `prisma migrate deploy` antes de iniciar, então a migração
acontece no deploy sem passo manual.

⚠️ **`OPERATOR_JWT_SECRET` precisa estar definida em qualquer comando do compose de
produção**, não só no `up`: o arquivo usa `${OPERATOR_JWT_SECRET:?...}`, e o
Compose avalia isso ao ler o arquivo. Até `docker compose -f docker-compose.prod.yml
down`, `ps` ou `logs` falham com "defina OPERATOR_JWT_SECRET" se ela não estiver no
`.env` (ou no `--env-file`) daquele comando.

**Serviços e portas.** O compose sobe também o `backoffice` (nginx estático com o
console da Blan, porta `8080`). A imagem dele é construída com a URL da API embutida:
defina `BACKOFFICE_API_URL` (padrão `http://localhost:3333`) com a URL pública da API
(ex.: `https://api.<domínio>`) e refaça o build quando ela mudar. A `api` e o `sync`
recebem `OPERATOR_JWT_SECRET`, `PANEL_ORIGIN`, `BACKOFFICE_ORIGIN` e
`MONDAY_API_TOKEN` do `.env` (o worker roda o mesmo `loadConfig`); as origens
precisam bater com as URLs públicas do painel e do back-office (CORS).

**Bind das portas.** `3333` (API) e `8080` (back-office) são publicadas só em
`127.0.0.1` (`API_BIND`, `BACKOFFICE_BIND`). O proxy reverso no mesmo host as alcança
por loopback; com `TRUST_PROXY_HOPS=1`, expor a `3333` direto à internet deixaria
qualquer um forjar `X-Forwarded-For`. Só defina `0.0.0.0` se o proxy estiver em outra
máquina.

**Teste de fumaça sem tocar no banco local.** Os dois composes compartilham o nome do
projeto e o volume `pgdata`, e o `api` de produção roda `migrate deploy`. Sempre use
um projeto e um env próprios. O `smoke.env` (valores fictícios) **precisa conter
`ENV_FILE=smoke.env`**, senão o `env_file` dos containers cai no `.env` real:

```bash
docker compose -p center-smoke -f docker-compose.prod.yml --env-file smoke.env up -d --build
curl -s localhost:3333/health && curl -sI localhost:8080/clientes
docker compose -p center-smoke -f docker-compose.prod.yml --env-file smoke.env down -v
```

**No primeiro deploy, o serviço `sync` executa um backfill de 90 dias.** Numa loja
com 10 mil pedidos/mês isso leva algumas horas por causa do limite de 60 req/min no
endpoint de detalhe da Uappi. É esperado. Acompanhe:

```bash
docker compose -f docker-compose.prod.yml logs -f sync
```

## Provisionamento: migração de dados, primeiro operador e back-office

`prisma migrate deploy` (rodado pelo serviço `api` acima) só cria o schema: num
banco novo ele continua **vazio**.

### Instalação existente: duas versões, nesta ordem

A produção atual está antes da migração `multitenant_foundation`, com a Uappi
embutida em colunas de `Organization`. A passagem é feita em **duas versões
separadas**, porque a segunda apaga colunas e não tem volta:

| Versão | Contém | Efeito |
|---|---|---|
| **1 — fundação** | todo o código multi-tenant e as migrações aditivas (`multitenant_foundation`, `operator_totp_lockout`, `user_password_changed_at`); **sem** a pasta `20261115000000_drop_legacy_org_integration_columns` | cria as tabelas novas; as colunas antigas continuam no banco (o Prisma ignora colunas a mais) |
| **2 — remoção** | só a pasta `20261115000000_drop_legacy_org_integration_columns` | apaga as colunas antigas de `Organization`; **irreversível** |

⚠️ **A versão 2 só sai num release posterior, separado**, e só depois de:

1. o `migrate-to-multitenant` ter rodado **na produção** (passo 1 abaixo), com a
   `CREDENTIALS_ENCRYPTION_KEY` correta e os `warnings` lidos;
2. a guarda da migração de remoção ter sido **testada numa cópia do banco de
   produção** (roteiro em [Testar a remoção numa cópia da produção](#testar-a-remoção-numa-cópia-da-produção)).

**1. Depois do deploy da versão 1**, rode uma vez o script de dados, idempotente:

```bash
docker compose -f docker-compose.prod.yml exec api node dist/scripts/migrate-to-multitenant.js
```

Ele preenche o `slug` dos clientes, move as integrações (Uappi, GA4, Play, App
Store, board do Monday) das colunas de `Organization` para a tabela `Integration`,
cifrando as credenciais com a `CREDENTIALS_ENCRYPTION_KEY`, e ativa os 7 módulos
para os clientes existentes. Imprime um relatório JSON com `warnings` (por exemplo,
"defina `MONDAY_API_TOKEN`"): leia-os. "Não pôde ser decifrado" significa chave
diferente da que cifrou os dados: rode de novo com a chave certa (o script não
mexe no que já copiou). Num banco novo não há o que migrar.

**2. Primeiro operador da Blan**, uma única vez, contra o serviço `api` já em pé:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e OPERATOR_EMAIL="voce@suaempresa.com" \
  -e OPERATOR_NAME="Seu Nome" \
  -e OPERATOR_PASSWORD="escolha uma senha forte" \
  api node dist/scripts/create-operator.js
```

O `db:seed` (que cria o operador `operator@center.local` e o Admin
`admin@center.local`, com senha publicada) é só para desenvolvimento: **não rode em
produção**.

**3. Back-office** (`admin.<domínio>`). O operador entra, cadastra o TOTP no primeiro
login (QR code ou segredo no app autenticador), cria o cliente, ativa os módulos,
configura as integrações e cria o Admin do cliente com senha provisória (a troca é
exigida no primeiro acesso). Roteiro completo no
[README](../README.md#parte-2--back-office-e-roteiro-manual). O antigo
`provision-admin` foi removido.

**Notas da versão 1 para os clientes:**

- **Todo usuário é deslogado uma vez** no deploy: os tokens anteriores não têm a
  audiência `client` e passam a dar 401. Basta entrar de novo.
- Trocar a senha encerra as outras sessões do usuário, e a nova senha precisa ser
  diferente da atual. Uma redefinição pelo Admin ou pela Blan também encerra as
  sessões abertas. `POST /auth/password` responde `200 { token }` (antes, `204`).
- Uma falha passageira do sync (Uappi fora do ar) não tira mais os módulos de
  commerce do ar: o painel mostra os dados com o aviso "dados da loja atualizados
  até…". Só credencial recusada pela Uappi marca a integração com erro.

## Remoção das colunas antigas (versão 2)

A migração `20261115000000_drop_legacy_org_integration_columns` apaga de
`Organization` as colunas de integração (Uappi, GA4, Play, App Store, Monday,
`statusMapping`). **É irreversível**: voltar exige restaurar o backup. Como o
container `api` roda `prisma migrate deploy` ao subir, ela é aplicada no deploy da
versão 2 — por isso essa versão só sai depois das duas condições acima.

Ela tem uma guarda (bloco `DO $$` no início) que aborta, sem apagar nada, se:

- algum cliente está sem `slug` (`rode migrate-to-multitenant antes desta migração`);
- algum valor legado não tem a `Integration` correspondente
  (`há integração legada não copiada para "Integration"; rode migrate-to-multitenant
  (com a chave correta) antes desta migração`) — é o que acontece quando o script
  rodou com a chave errada.

Se a guarda disparar, a migração fica registrada como falha (`P3018`) e os deploys
seguintes param com `P3009`; o container `api` entra em loop de reinício e `exec`
não funciona nele. Saída, com `run --rm` (um container avulso da mesma imagem):

```bash
docker compose -f docker-compose.prod.yml run --rm api \
  node dist/scripts/migrate-to-multitenant.js
docker compose -f docker-compose.prod.yml run --rm api \
  npx prisma migrate resolve --rolled-back 20261115000000_drop_legacy_org_integration_columns
docker compose -f docker-compose.prod.yml up -d
```

(Corrija a causa antes: a chave certa no `ENV_FILE`, ou anule de propósito a coluna
legada que você abandona.)

### Testar a remoção numa cópia da produção

Obrigatório antes do release da versão 2. Nada aqui toca o banco de produção além
do `pg_dump`.

1. Dump da produção (já com a versão 1 e o `migrate-to-multitenant` aplicados):

   ```bash
   docker compose -f docker-compose.prod.yml exec postgres \
     sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/prod.dump'
   docker compose -f docker-compose.prod.yml cp postgres:/tmp/prod.dump ./prod.dump
   ```

2. Restaurar num Postgres descartável, em outra porta:

   ```bash
   docker run -d --name center-prod-copy -e POSTGRES_USER=center -e POSTGRES_PASSWORD=center \
     -e POSTGRES_DB=center_copy -p 55433:5432 postgres:16-alpine
   docker cp ./prod.dump center-prod-copy:/tmp/prod.dump
   docker exec center-prod-copy pg_restore -U center -d center_copy --no-owner /tmp/prod.dump
   ```

3. Num checkout da **versão 2**, aplicar as migrações na cópia:

   ```bash
   DATABASE_URL="postgresql://center:center@localhost:55433/center_copy?schema=public" \
     pnpm --filter @center/api exec prisma migrate deploy
   ```

   Esperado: só `20261115000000_drop_legacy_org_integration_columns` aplicada, sem
   erro. Se a guarda abortar, **não publique**: rode o script com a chave certa na
   produção e repita a partir do passo 1.
4. Conferir que as integrações estão lá e que as colunas sumiram:

   ```bash
   docker exec center-prod-copy psql -U center -d center_copy \
     -c 'SELECT "organizationId", kind, provider, status FROM "Integration" ORDER BY 1, 2;' \
     -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'Organization';"
   ```

5. `docker rm -f center-prod-copy` e apague o `prod.dump` (tem dados de clientes).

Em 2026-11-04 este roteiro foi exercitado num banco descartável com uma
`Organization` legada preenchida: a guarda abortou sem `slug`, abortou com o script
rodado com a chave errada, e passou depois do script com a chave certa, com as
credenciais decifrando corretamente em `Integration`. A migração aditiva
`20261116000000_user_password_changed_at`, aplicada na versão 1, não atrapalha: o
Prisma aplica a de remoção depois dela sem reclamar da ordem.

## Acessando o dashboard

A API (`dist/main.js`) também serve o dashboard React já compilado
(`apps/web/dist`, empacotado na mesma imagem) na própria origem — não existe (nem é
necessário) um serviço `web` separado no `docker-compose.prod.yml`. Depois do
provisionamento acima, abra `http://<host>:3333/` (ou o domínio que aponta para o
serviço `api`) e faça login como Admin do cliente, com a senha provisória definida pelo operador no back-office (a troca é exigida no primeiro acesso). Rotas do
dashboard que não existem como arquivo (ex.: `/produtos`, uma rota client-side do
react-router) caem de volta na `index.html`, então o deep-link funciona; rotas
desconhecidas sob `/api`, `/auth`, `/public` e `/webhooks` continuam devolvendo 404
JSON normalmente, nunca a página do dashboard. `/center-attribution.js` (usado pelo
runbook `docs/checkout-attribution.md`) fica na mesma origem, em
`http://<host>:3333/center-attribution.js`.

## Verificação pós-deploy

```bash
curl -f http://localhost:3333/health
docker compose -f docker-compose.prod.yml exec api node dist/scripts/health-report.js
```

## O que monitorar

| Sinal | Onde | Por que importa |
|---|---|---|
| `SyncState.lastSyncedAt` | `health-report.js`, a cada 30 min | **O mais importante.** Sync parado = dashboard e bot respondendo com dados velhos, sem avisar ninguém |
| `SyncState.lastError` | idem | Credencial da Uappi expirada, mudança de contrato da API |
| Profundidade da fila `whatsapp-inbound` | `LLEN bull:whatsapp-inbound:wait` | Fila crescendo = worker morto. Passando de 24 h, o envio falha com erro 131047 |
| Taxa de falha em `ToolCallLog` | `health-report.js` | Fonte de dados fora do ar |
| 401 em `/webhooks/whatsapp` | Log da API | `WHATSAPP_APP_SECRET` errado, ou alguém sondando o endpoint |
| Latência de `/api/metrics/query` | Log da API | Acima de 3 s sustentados: cache frio ou Redis fora |
| Bytes faturados no BigQuery | Console do GCP | Query da Fase 8 sem filtro de partição |

## Rotação do PII_PEPPER

Trocar o `PII_PEPPER` **invalida todos os hashes já gravados** — é o mecanismo de
revogação em caso de vazamento, e é destrutivo por design. Depois de trocar:

1. `TRUNCATE "AttributionTouch";`
2. `UPDATE "CommerceOrder" SET "visitorHash" = NULL;`
3. `UPDATE "CommerceCustomer" SET "emailHash" = NULL, "documentHash" = NULL;`
4. `UPDATE "SyncState" SET "backfillDoneAt" = NULL;` — força um novo backfill, que
   regrava os hashes com o pepper novo a partir de `rawPayload`.

A atribuição histórica anterior ao vazamento é perdida. Isso é intencional.

## Rollback

```bash
git checkout <tag-anterior>
docker compose -f docker-compose.prod.yml up -d --build
```

Duas migrações removem colunas: `20260915171555_sprint_cycle_and_numbering`
(apaga `SprintTask.sprintLabel`) e `20261115000000_drop_legacy_org_integration_columns`
(apaga as colunas antigas de integração de `Organization`). Voltar o código para
antes de qualquer uma delas exige restaurar o backup do banco; nas demais, as
migrações são aditivas e voltar o código basta.

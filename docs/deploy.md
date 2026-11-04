# Deploy

> **Arquitetura em transição.** Este guia descreve o deploy atual (uma API que
> serve o painel, um worker de sync e o worker de WhatsApp). No alvo aprovado em
> 2026-10-29 ([design](superpowers/specs/2026-10-29-multi-tenant-modular-design.md)):
>
> - Dois frontends com build próprio: painel do cliente em `app.<domínio>` e
>   back-office da Blan em `admin.<domínio>`.
> - A mesma API atende `/api/*` (cliente) e `/internal/*` (operador), com CORS
>   separado (`PANEL_ORIGIN`, `BACKOFFICE_ORIGIN`) e segredo de token próprio
>   para operadores (`OPERATOR_JWT_SECRET`).
> - Variável global nova: `MONDAY_API_TOKEN`. As `WHATSAPP_*` deixam de ser
>   obrigatórias e o serviço `whatsapp` sai do compose padrão.
> - Na primeira subida da versão multi-tenant, depois do `prisma migrate
>   deploy`, roda-se uma vez o script de dados `migrate-to-multitenant`
>   (idempotente), que move as integrações da organização atual para a tabela
>   `Integration` e ativa todos os módulos para ela.
> - O back-office é servido por um container estático próprio
>   (`admin.<domínio>`) e chama a API pela URL absoluta.
> - O provisionamento passa a ser: script `create-operator` para o primeiro
>   operador e, depois, tudo pelo back-office (clientes, módulos, integrações e
>   o primeiro Admin de cada cliente).

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
dentro dos containers `api`/`sync`/`whatsapp` deste compose de produção eles são
**sobrescritos** por um bloco `environment:` que aponta para `postgres:5432` e
`redis:6379` — os nomes de serviço na rede interna do Compose, os únicos endereços
que os containeres irmãos realmente enxergam. Isso evita depender de manter dois
valores diferentes de `DATABASE_URL`/`REDIS_URL` no mesmo arquivo `.env` para os dois
cenários (local vs. este compose).

O serviço `api` roda `prisma migrate deploy` antes de iniciar, então a migração
acontece no deploy sem passo manual.

**Serviços e portas.** O compose sobe também o `backoffice` (nginx estático com o
console da Blan, porta `8080`). A imagem dele é construída com a URL da API embutida:
defina `BACKOFFICE_API_URL` (padrão `http://localhost:3333`) com a URL pública da API
(ex.: `https://api.<domínio>`) e refaça o build quando ela mudar. A `api` recebe
`OPERATOR_JWT_SECRET`, `PANEL_ORIGIN`, `BACKOFFICE_ORIGIN` e `MONDAY_API_TOKEN` do
`.env`; as origens precisam bater com as URLs públicas do painel e do back-office
(CORS).

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

## Provisionamento do primeiro operador e dos clientes

`prisma migrate deploy` (rodado automaticamente pelo serviço `api` acima) só cria o
schema — o banco continua **vazio**. Crie o primeiro operador da Blan, uma única
vez, contra o serviço `api` já em pé:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e OPERATOR_EMAIL="voce@suaempresa.com" \
  -e OPERATOR_NAME="Seu Nome" \
  -e OPERATOR_PASSWORD="escolha uma senha forte" \
  api node dist/scripts/create-operator.js
```

O operador entra no back-office (`admin.<domínio>`; o TOTP é cadastrado no primeiro
login), cria o cliente, suas integrações e módulos, e cria o Admin do cliente com
senha provisória. O antigo `provision-admin` foi removido.

## Remoção das colunas antigas (Task 21)

A migração `20261115000000_drop_legacy_org_integration_columns` apaga de
`Organization` as colunas de integração (Uappi, GA4, Play, App Store, Monday,
`statusMapping`). **É irreversível.** Como o container `api` roda
`prisma migrate deploy` ao subir, o `migrate-to-multitenant` precisa ter rodado
com sucesso no ambiente ANTES de publicar a versão que contém esta migração.

1. Faça backup do banco.
2. `pnpm -w build`. O script lê as colunas legadas por `$queryRaw`, então a
   versão do Prisma client não importa.
3. `node apps/api/dist/scripts/migrate-to-multitenant.js` (com a
   `CREDENTIALS_ENCRYPTION_KEY` correta do ambiente; confira os avisos).
4. `pnpm --filter @center/api exec prisma migrate deploy`.
5. `pnpm --filter @center/api exec prisma generate`.
6. `pnpm -w build`.
7. `node apps/api/dist/scripts/migrate-to-multitenant.js` de novo (deve rodar
   sem planejar integrações).

A migração tem duas proteções: recusa se algum cliente está sem `slug` ou se
guarda um valor legado sem a `Integration` correspondente. Se disparar, ela fica
registrada como falha e os deploys seguintes param com `P3009`. Corrija a causa
(rode o script com a chave certa, ou anule a coluna legada que você abandona de
propósito), rode
`pnpm --filter @center/api exec prisma migrate resolve --rolled-back 20261115000000_drop_legacy_org_integration_columns`
e faça o deploy de novo.

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
docker compose -f docker-compose.prod.yml logs whatsapp | grep "worker do WhatsApp em execução"
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

Migrações do Prisma são aditivas neste projeto (nenhuma coluna é removida), então
voltar o código não exige reverter o banco.

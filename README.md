# Center Dashboard

SaaS de analytics para lojas virtuais da Blan: vendas do e-commerce, GA4, uso do
app, qualidade nas lojas de apps e sprint da equipe de desenvolvimento num
painel, com um assistente de IA que responde perguntas sobre esses dados.

É **multi-tenant** e **modular**: cada cliente é isolado, contrata **módulos**
(visão geral, produtos, aquisição, uso do app, qualidade, sprint, assistente) e
é configurado pela equipe da Blan num **back-office** (clientes, módulos,
integrações e o primeiro Admin). As plataformas de e-commerce entram como
**conectores** (a Uappi é o primeiro). O canal de WhatsApp está fora do MVP.

- Design: [docs/superpowers/specs/2026-10-29-multi-tenant-modular-design.md](docs/superpowers/specs/2026-10-29-multi-tenant-modular-design.md)
- Regras e invariantes para quem desenvolve: [CLAUDE.md](CLAUDE.md)
- Deploy: [docs/deploy.md](docs/deploy.md)

# Rodar o projeto localmente

Do zero a um painel preenchido, com back-office, Admin, Membro e testes. Tudo
aqui foi executado neste repositório; os ⚠️ marcam armadilhas reais, não
hipóteses. Este é o único roteiro: o `docs/rodar-local.md` só aponta para cá.

## Pré-requisitos

| Ferramenta | Versão |
|---|---|
| Node.js | 22 LTS |
| pnpm | 9.x |
| Docker Desktop | qualquer recente |

Postgres e Redis sobem via Docker — não instale nenhum dos dois.

**Windows.** Todo comando que define variável de ambiente ou passa SQL tem as
duas formas: **bash** (Git Bash, WSL, macOS, Linux) e **PowerShell**. As formas
PowerShell foram testadas no **Windows PowerShell 5.1** (o `powershell.exe` do
Windows 10/11). Três diferenças que quebram comando copiado do bash:

- `VAR=x comando` não existe: use `$env:VAR = "x"; comando`.
- `curl` é um apelido de `Invoke-WebRequest`: use `curl.exe`.
- Aspas duplas **dentro** de um argumento somem ao chamar `docker`/`psql`
  (`"SyncState"` vira `SyncState` e o Postgres responde
  `relation "syncstate" does not exist`). Por isso o SQL vai pela entrada
  padrão, num here-string (`@' ... '@ | docker compose exec -T ...`), que
  funciona em qualquer versão do PowerShell. O `'@` final precisa estar na
  coluna 0.
- O `--` sozinho (como em `pnpm test -- --coverage`) é engolido pelo
  `pnpm.ps1`: escreva `'--'`, entre aspas simples.

---

# Parte 1 — Painel

## 1. Subir banco e cache

```bash
docker compose up -d
docker compose ps          # os dois devem estar "Up (healthy)"
```

(Iguais no PowerShell.)

## 2. Criar o `.env`

```bash
cp .env.example .env
```

```powershell
Copy-Item .env.example .env
```

Edite com estes valores para rodar sem credenciais externas:

```bash
DATABASE_URL="postgresql://center:center@localhost:5432/center?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="dev-jwt-secret-com-no-minimo-32-caracteres"
OPERATOR_JWT_SECRET="dev-operator-secret-diferente-com-32-caracteres"
PII_PEPPER="dev-pii-pepper-com-no-minimo-32-caracteres"
CREDENTIALS_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
MOCK_EXTERNAL_APIS="true"
# As fixtures de pedido são de julho/2026: o primeiro sync precisa olhar 2 anos
# para trás (o padrão é 90 dias). Veja o passo 6.
SYNC_BACKFILL_DAYS="730"
UAPPI_BASE_URL="https://api.uappi.com.br"
GA4_CREDENTIALS_JSON=""
ANTHROPIC_API_KEY="placeholder"
```

⚠️ **`OPERATOR_JWT_SECRET` é obrigatória**: é o segredo dos tokens dos
operadores da Blan no back-office. Precisa de 32+ caracteres e **não pode ser
igual** ao `JWT_SECRET` — sem ela, ou igual a ele, a API, o sync e os scripts
não sobem.

⚠️ `JWT_SECRET` e `PII_PEPPER` precisam de 32+ caracteres;
`CREDENTIALS_ENCRYPTION_KEY` de exatamente 64 hex. O `.env.example` traz
`CREDENTIALS_ENCRYPTION_KEY` vazia, e vazia a API não sobe. Para gerar valores
aleatórios (o `openssl` não vem no Windows; o Node serve nos dois):

```bash
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

As credenciais do GA4 (`GA4_CREDENTIALS_JSON`, `GA4_APP_CREDENTIALS_JSON`) e o
`MONDAY_API_TOKEN` são **globais da Blan**, no `.env`. O que é por cliente
(credenciais da Uappi, `propertyId` do GA4, `boardId` do Monday, lojas de apps)
fica na tabela `Integration` e se configura no back-office (Parte 2).
`PANEL_ORIGIN` e `BACKOFFICE_ORIGIN` (CORS) já têm os padrões de desenvolvimento
(`http://localhost:5173` e `http://localhost:5174`).

⚠️ Só a string literal `"true"` liga o modo mock. `1`, `yes` ou `True` viram
`false` em silêncio.

⚠️ `ANTHROPIC_API_KEY` é obrigatória **mesmo em modo mock** — a API não sobe
sem ela. Um placeholder basta para o painel. As `WHATSAPP_*` são opcionais: sem
elas o canal de WhatsApp (fora do MVP) fica desligado.

## 3. Carregar o `.env` no terminal

```bash
cd apps/api
set -a && . ../../.env && set +a
```

```powershell
Set-Location apps\api
Get-Content ..\..\.env | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item -Path "env:$($name.Trim())" -Value $value.Trim('"', ' ')
}
```

⚠️ **Nada neste projeto lê o `.env` sozinho** — nem a API, nem o Prisma (ele
procura em `apps/api/`, e o nosso está na raiz). Sem isso você recebe
`Environment variable not found: DATABASE_URL`.

⚠️ Vale **só para o terminal atual**. Cada terminal novo (API, sync, painel em
dev) precisa repetir este passo.

## 4. Instalar, migrar e compilar

> **Já tem um banco local de antes do multi-tenant** (um banco em que a
> migração `20261030000000_multitenant_foundation` ainda não rodou, com a Uappi
> em colunas de `Organization`)? **Não siga este passo**: vá para [Banco local de antes do multi-tenant](#banco-local-de-antes-do-multi-tenant)
> e volte para o passo 5. Banco novo ou descartável: siga em frente.

```bash
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm -w build
```

(Iguais no PowerShell.)

⚠️ Fique em `apps/api` daqui até o fim da Parte 1 — `db:seed`, `start` e
`start:sync` só existem nesse pacote. O `-w` alcança a raiz do workspace sem te
mover de pasta.

### Banco local de antes do multi-tenant

A migração `20261115000000_drop_legacy_org_integration_columns` apaga as
colunas antigas de integração de `Organization` e **é irreversível**. Ela tem
uma guarda: aborta se o script `migrate-to-multitenant` ainda não copiou os
dados para `Integration`. Por isso, num banco antigo, o `migrate deploy`
aplica a fundação e **para** na remoção, com `P3018` (e `P3009` nos deploys
seguintes). É esperado; o caminho é este:

1. **Backup** (o arquivo fica na pasta atual, `apps/api`):

   ```bash
   docker compose exec postgres pg_dump -U center -d center -Fc -f /tmp/center.dump
   docker compose cp postgres:/tmp/center.dump ./center.dump
   ```

   No PowerShell, os mesmos dois comandos. ⚠️ Não use
   `pg_dump ... > center.dump` no PowerShell 5.1: o `>` grava em UTF-16 e
   corrompe o dump.
2. Instalar e compilar (o script precisa do `dist/`):

   ```bash
   pnpm install
   pnpm exec prisma generate
   pnpm -w build
   ```

3. `pnpm exec prisma migrate deploy`. Aplica a fundação e as migrações
   aditivas; a remoção falha na guarda com
   `rode migrate-to-multitenant antes desta migração`.
4. `node dist/scripts/migrate-to-multitenant.js`. Preenche o `slug`, copia as
   integrações para `Integration` (cifrando com a `CREDENTIALS_ENCRYPTION_KEY`
   do `.env`) e ativa os 7 módulos. Leia os `warnings` do JSON: "não pôde ser
   decifrado" significa chave diferente da que cifrou os dados — a guarda vai
   barrar a remoção de novo até você rodar com a chave certa.
5. Só se o passo 3 falhou:
   `pnpm exec prisma migrate resolve --rolled-back 20261115000000_drop_legacy_org_integration_columns`.
6. `pnpm exec prisma migrate deploy`. Agora a remoção passa.

Volte ao passo 5 (o `db:seed` não mexe em quem já existe).

Dados descartáveis? `docker compose down -v` **apaga tudo** (volume
`pgdata`) e você recomeça do passo 1 com banco novo.

## 5. Criar usuário e operador de desenvolvimento

```bash
pnpm db:seed
```

Cria, de forma idempotente:

| O quê | Valor |
|---|---|
| Cliente | `Loja de Desenvolvimento` (`org_dev`), com os 7 módulos ativos |
| Admin do cliente | `admin@center.local` / `center-dev-123` |
| Operador da Blan | `operator@center.local` / `center-dev-123` (sem TOTP: o cadastro acontece no primeiro login; **não** é criado com `NODE_ENV=production`) |

⚠️ Essas senhas estão publicadas no repositório. Servem para a sua máquina e
nada mais. Em ambiente compartilhado ou de produção crie o primeiro operador
com o script (ele recusa e-mail já existente):

```bash
OPERATOR_EMAIL="rafael@exemplo.com" \
OPERATOR_NAME="Rafael" \
OPERATOR_PASSWORD="uma-senha-longa-de-verdade" \
  node dist/scripts/create-operator.js
```

```powershell
$env:OPERATOR_EMAIL = "rafael@exemplo.com"
$env:OPERATOR_NAME = "Rafael"
$env:OPERATOR_PASSWORD = "uma-senha-longa-de-verdade"
node dist/scripts/create-operator.js
Remove-Item Env:OPERATOR_PASSWORD, Env:OPERATOR_EMAIL, Env:OPERATOR_NAME
```

O operador entra no back-office (Parte 2), onde o TOTP é cadastrado no primeiro
login.

## 6. Popular os dados

```bash
SYNC_BACKFILL_DAYS=730 node dist/scripts/seed-demo.js
```

```powershell
$env:SYNC_BACKFILL_DAYS = "730"; node dist/scripts/seed-demo.js
```

(Com o `SYNC_BACKFILL_DAYS="730"` do passo 2 já carregado, basta
`node dist/scripts/seed-demo.js`.)

Um comando cobre as integrações mockadas: grava as `Integration` do primeiro
cliente do banco (`org_dev`: e-commerce Uappi com credenciais cifradas, GA4 web
e app, Play Store, App Store e Sprint) e sincroniza os pedidos pelo pipeline
real. Ao final ele imprime as contagens e **o período que você deve escolher no
painel**.

Esperado: 25 pedidos, 35 itens, 22 clientes, R$ 5.254,40, de 2026-07-01 a
2026-07-29.

⚠️ As fixtures de pedido são de **julho/2026** e o primeiro sync só busca os
últimos `SYNC_BACKFILL_DAYS` dias (padrão 90). Fora dessa janela o sync termina
com 0 pedidos **e marca o backfill como feito**: rodar de novo não traz nada.
Se isso aconteceu, zere o estado de sync **do `org_dev`** e repita:

```bash
docker compose exec postgres psql -U center -d center -c 'DELETE FROM "SyncState" WHERE "organizationId" = '"'"'org_dev'"'"';'
```

```powershell
@'
DELETE FROM "SyncState" WHERE "organizationId" = 'org_dev';
'@ | docker compose exec -T postgres psql -U center -d center
```

Para um cliente criado no back-office, troque `org_dev` pelo id dele. Sem o
`WHERE`, o comando zera o sync de **todos** os clientes do banco local — só
faça isso em dev, de propósito.

⚠️ Recusa se `MOCK_EXTERNAL_APIS` não for `"true"`, e nunca sobrescreve
integração já configurada. Pode rodar duas vezes sem duplicar nada.

## 7. Subir a API e o sync

```bash
pnpm start
```

Painel em **http://localhost:3333**. Confira (bash / PowerShell):

```bash
curl http://localhost:3333/health
curl.exe http://localhost:3333/health
```

**Sync worker**, em **outro terminal** (com o `.env` carregado, passo 3, e em
`apps/api`):

```bash
pnpm start:sync
```

Ele roda um ciclo na hora e depois a cada `SYNC_INTERVAL_MINUTES` (30). O
`org_dev` já foi sincronizado pelo `seed-demo`; o worker é o que traz os
pedidos de um **cliente criado no back-office** (Parte 2). Espere
`sync worker iniciado` e `ciclo concluído ... succeeded`.

Para mexer nos frontends com hot reload, cada um em outro terminal:

```bash
pnpm --filter @center/web dev          # painel do cliente: http://localhost:5173
pnpm --filter @center/backoffice dev   # back-office da Blan: http://localhost:5174
```

⚠️ O proxy do Vite do painel cobre só `/api` e `/auth`. Para `/public/*` e
`/webhooks/*` use a 3333 direto. O back-office não usa proxy: chama a API por
URL absoluta (`VITE_API_URL`, padrão `http://localhost:3333`), e o CORS aceita
as origens `PANEL_ORIGIN` (5173) e `BACKOFFICE_ORIGIN` (5174).

## 8. Escolher o período

⚠️ As fixtures são de **julho/2026**. Os presets **Hoje**, **7 dias** e **30
dias** só mostram dados enquanto julho/2026 estiver dentro da janela; fora dela
aparecem vazios — corretamente. Escolha um intervalo customizado que cubra
2026-07-01 a 2026-07-29.

Os estados de um card ou de uma tela significam coisas diferentes:

| Na tela | Significado |
|---|---|
| "Aguardando configuração" (card) ou "A equipe Blan está configurando as integrações deste módulo" (página) | A integração da fonte ainda não está pronta (API: 409 `integration_pending`). Nada foi consultado |
| `fonte de dados indisponível` (vermelho) | A consulta **falhou** na fonte externa (API: 502). Ex.: GA4 sem acesso à propriedade |
| `Sem dados no período selecionado` | A consulta **funcionou** e voltou vazia — falta dado ou o período não cobre |
| Aviso "Dados da loja atualizados até…" | A última tentativa de sync falhou; os dados até aquela hora continuam na tela |

---

# Parte 2 — Back-office e roteiro manual

O back-office é o console da equipe Blan. É aqui que se cria o cliente, se
ativam os módulos, se configuram as integrações (credenciais, propriedades GA4,
board do Monday) e se cria o primeiro Admin. O cliente nunca vê credenciais.

Pré-requisitos: API no ar (Parte 1, passo 7), o **sync worker** rodando (para
clientes novos) e, cada um no seu terminal:

- `pnpm --filter @center/backoffice dev` → **http://localhost:5174**;
- `pnpm --filter @center/web dev` → **http://localhost:5173** (necessário para
  "Visualizar painel", passo 9).

⚠️ Use **um perfil de navegador ou uma janela anônima para cada papel**: Admin,
Membro e visualização. O token fica no `localStorage` da origem, e abrir outro
papel na mesma janela derruba a sessão do anterior.

## Back-office

1. **Login.** Entre com `operator@center.local` / `center-dev-123` (o operador
   do `db:seed`) ou com o operador criado pelo `create-operator`.
2. **TOTP no primeiro login.** A tela mostra um QR code e o segredo.
   - Cadastre num app autenticador (Google Authenticator, Microsoft
     Authenticator, 1Password, Authy) e informe o código de 6 dígitos.
   - O relógio do PC e o do celular precisam estar certos (sincronização
     automática de hora ligada); um desvio de mais de ~30 s recusa o código.
   - Até confirmar, **cada novo login gera um segredo novo**: cadastre o
     último QR mostrado e apague as entradas antigas do app.
   - Nos logins seguintes só o código é pedido. Cinco códigos errados bloqueiam
     o operador por 15 minutos.
   - **Perdeu o autenticador (só em dev)?** Zere o TOTP do operador e faça o
     cadastro de novo no próximo login:

     ```bash
     docker compose exec postgres psql -U center -d center -c 'UPDATE "PlatformOperator" SET "totpEnabledAt" = NULL, "totpSecret" = NULL, "failedTotpAttempts" = 0, "totpLockedUntil" = NULL WHERE email = '"'"'operator@center.local'"'"';'
     ```

     ```powershell
     @'
     UPDATE "PlatformOperator" SET "totpEnabledAt" = NULL, "totpSecret" = NULL,
       "failedTotpAttempts" = 0, "totpLockedUntil" = NULL
     WHERE email = 'operator@center.local';
     '@ | docker compose exec -T postgres psql -U center -d center
     ```

     (No PowerShell o `'@` final fica na coluna 0 — aqui ele aparece recuado
     só por estar dentro da lista.) Em produção não há fluxo de recuperação
     ainda: é uma questão em aberto da spec.
3. **Criar o cliente.** Em **Clientes**, informe o nome (o slug é gerado, ou
   informado e único). O cliente nasce sem módulos e sem integrações.
4. **Módulos.** Na aba **Módulos**, ative os contratados (ex.: `overview` e
   `products`). Módulo em vigor sem a integração que ele exige aparece como
   "aguardando configuração".
5. **Integrações.** Na aba **Integrações**, configure as do cliente (Uappi com
   `apiKey`/`secretKey`, GA4, lojas de apps, board do Monday). Segredos são
   cifrados e nunca voltam pela API. A aba mostra também o snippet de
   atribuição para o site da loja ([docs/checkout-attribution.md](docs/checkout-attribution.md)).
   Em modo mock:
   - qualquer `apiKey`/`secretKey` serve (não há chamada à Uappi);
   - o `propertyId` do GA4 precisa ser **numérico** (ex.: `123456`);
   - **todo** cliente em mock recebe os **mesmos** pedidos de fixture
     (julho/2026), então o painel de um cliente novo fica igual ao do `org_dev`;
   - os pedidos só aparecem depois de um ciclo do **sync worker** (Parte 1,
     passo 7) com `SYNC_BACKFILL_DAYS=730` no ambiente dele. Com o padrão (90)
     o primeiro sync traz 0 pedidos e marca o backfill como feito; corrija com
     o `DELETE FROM "SyncState"` do passo 6, usando o id do cliente.
6. **Primeiro Admin.** Na aba **Usuários**, crie o Admin com e-mail e senha
   provisória (mínimo 12 caracteres). Informe a senha ao cliente por fora: não
   há e-mail no MVP.
7. **Entrar como Admin.** Em http://localhost:5173 (ou 3333) o Admin faz login
   e é obrigado a trocar a senha. A nova senha precisa ser **diferente** da
   provisória. A troca encerra as outras sessões abertas desse usuário; a aba
   em que você trocou continua logada.

## Roteiro manual com o `org_dev` (Admin e Membro)

Com o `org_dev` semeado (Parte 1), sem precisar do back-office:

1. **Admin.** Em http://localhost:5173, entre com `admin@center.local` /
   `center-dev-123`. O menu mostra os 7 módulos; **Configurações** mostra o
   status das integrações (nunca credenciais).
2. **Criar um Membro.** Em **Usuários** → novo usuário `membro@center.local`,
   papel **Membro**, só o módulo **Produtos**, senha provisória com 12+
   caracteres (ex.: `provisoria-123`).
3. **Entrar como Membro**, em **outra janela anônima/perfil**: login com a
   provisória → a tela de troca de senha aparece → escolha a nova (ex.:
   `membro-nova-123`) → o menu mostra só **Produtos**.
4. **Token para testar a API por linha de comando** (troque a senha pela que
   você escolheu):

   ```bash
   TOKEN=$(curl -s -X POST http://localhost:3333/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"membro@center.local","password":"membro-nova-123"}' \
     | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")
   curl -s -X POST http://localhost:3333/api/tools/ga4/traffic_sources \
     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"from":"2026-07-01","to":"2026-07-29"}'
   # → 403 {"error":"module_not_available",...}
   curl -s -X POST http://localhost:3333/api/tools/commerce/top_products \
     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"from":"2026-07-01","to":"2026-07-29"}'
   # → 200 com o ranking de produtos
   ```

   ```powershell
   $login = Invoke-RestMethod -Method Post -Uri http://localhost:3333/auth/login `
     -ContentType 'application/json' `
     -Body '{"email":"membro@center.local","password":"membro-nova-123"}'
   $headers = @{ authorization = "Bearer $($login.token)" }
   $period = '{"from":"2026-07-01","to":"2026-07-29"}'
   try {
     Invoke-RestMethod -Method Post -Uri http://localhost:3333/api/tools/ga4/traffic_sources `
       -Headers $headers -ContentType 'application/json' -Body $period
   } catch { $_.Exception.Response.StatusCode.value__; $_.ErrorDetails.Message }
   # → 403 {"error":"module_not_available",...}
   Invoke-RestMethod -Method Post -Uri http://localhost:3333/api/tools/commerce/top_products `
     -Headers $headers -ContentType 'application/json' -Body $period
   # → o ranking de produtos
   ```

   O mesmo vale para o Admin (`admin@center.local`), que recebe 200 nas duas.
5. **Caminhos negados que valem conferir:**
   - token do Membro em `GET /api/users` → 403 `forbidden` (só Admin);
   - logo depois de criado, antes de trocar a senha, qualquer rota de dados →
     403 `password_change_required`;
   - depois de uma troca ou de uma redefinição de senha (pelo Admin ou pela
     Blan), um token antigo → 401;
   - no back-office, suspender o módulo `products` → a próxima requisição do
     Membro com o **mesmo** token já dá 403 `module_not_available`.

## Visualizar painel (sessão da Blan)

8. Na página do cliente, no back-office, **Visualizar painel** abre uma sessão
   **somente leitura** de 30 minutos, com faixa visível e sem assistente,
   registrada na auditoria (**Auditoria** no menu).
9. ⚠️ O link vai para `PANEL_ORIGIN/view-session`, que por padrão é
   `http://localhost:5173`: deixe o painel em dev rodando
   (`pnpm --filter @center/web dev`), **ou** defina
   `PANEL_ORIGIN=http://localhost:3333` no `.env`, recarregue o `.env` e
   reinicie a API. O token da visualização substitui o `center.token` daquela
   origem: abra numa janela anônima para não perder a sessão de Admin.

---

# Rodar os testes

⚠️ **Nunca aponte os testes para o banco de dev.** As suítes de `mcp-commerce`,
`mcp-quality` e `mcp-sprint` gravam num Postgres real: criam os clientes
`org_test_commerce`, `org_test_quality` e `org_test_sprint` e apagam os dados
deles a cada teste. Elas **recusam** rodar se o nome do banco em `DATABASE_URL`
não terminar em `_test` (`Recusado: DATABASE_URL aponta para o banco
"center"...`). As demais suítes não usam banco.

Na **raiz** do repositório, num terminal **sem** o `.env` de dev carregado (ou
sobrescreva as duas variáveis como abaixo). Uma vez, crie o banco de teste no
Postgres do `docker compose`:

```bash
docker compose exec postgres psql -U center -d center -c "CREATE DATABASE center_test;"
export DATABASE_URL="postgresql://center:center@localhost:5432/center_test?schema=public"
export REDIS_URL="redis://localhost:6379"
pnpm --filter @center/api exec prisma migrate deploy
pnpm build && pnpm typecheck && pnpm test -- --coverage
```

```powershell
docker compose exec postgres psql -U center -d center -c "CREATE DATABASE center_test;"
$env:DATABASE_URL = "postgresql://center:center@localhost:5432/center_test?schema=public"
$env:REDIS_URL = "redis://localhost:6379"
pnpm --filter @center/api exec prisma migrate deploy
pnpm build; if ($?) { pnpm typecheck }; if ($?) { pnpm test '--' --coverage }
```

- É o mesmo que o CI roda (`.github/workflows/ci.yml`, banco `center_test`). O
  `--coverage` liga os limiares de cobertura de cada pacote.
- O `turbo.json` repassa `DATABASE_URL` e `REDIS_URL` para a tarefa `test`;
  sem isso o modo estrito do turbo as apagaria. Não use `--env-mode=loose`.
- O `CREATE DATABASE` só precisa ser feito uma vez (de novo dá
  `already exists`, inofensivo). Antes de cada rodada depois de puxar
  migrações novas, repita o `migrate deploy` contra o `center_test`.
- Prefere não tocar no Postgres de dev? Um container descartável em outra porta
  serve igual:
  `docker run -d --name center-test-pg -e POSTGRES_USER=center -e POSTGRES_PASSWORD=center -e POSTGRES_DB=center_test -p 55432:5432 postgres:16-alpine`,
  `DATABASE_URL` com a porta `55432`, e no fim `docker rm -f center-test-pg`.
- Um pacote só: `pnpm --filter @center/api test` (as mesmas variáveis valem).

---

# Parte 3 — WhatsApp

> **Fora do MVP.** O canal está desligado no código (rotas comentadas desde
> 2026-09-30) e foi adiado na nova arquitetura até que os detalhes do canal e
> os custos dos agentes sejam definidos. Os passos abaixo ficam como
> referência.

Precisa de três coisas que o painel não precisa: chave real da Anthropic,
credenciais reais da Meta e um **túnel público** (a Meta entrega por webhook e
precisa alcançar sua máquina). Não há como testar só com mock.

## 1. Credenciais da Meta

Detalhes em [`docs/whatsapp-setup.md`](docs/whatsapp-setup.md). Preencha no `.env`:

| Variável | Onde achar |
|---|---|
| `WHATSAPP_APP_SECRET` | App → Configurações → Básico → Chave secreta |
| `WHATSAPP_ACCESS_TOKEN` | App → WhatsApp → Configuração da API |
| `WHATSAPP_PHONE_NUMBER_ID` | App → WhatsApp → Configuração da API |
| `WHATSAPP_VERIFY_TOKEN` | Você inventa |

Mais uma `ANTHROPIC_API_KEY` real.

⚠️ A verificação do negócio na Meta leva de 3 dias a 3 semanas.

## 2. Expor a API

```bash
npx localtunnel --port 3333
```

## 3. Cadastrar o webhook

App → WhatsApp → Configuração → Webhooks:

- **URL:** `https://<sua-url>/webhooks/whatsapp`
- **Token:** o mesmo de `WHATSAPP_VERIFY_TOKEN`
- **Campos:** só `messages`

A Meta faz um `GET` na hora. Falha aqui é quase sempre token divergente.

## 4. Subir o worker

Em outro terminal (com o `.env` carregado, passo 3 da Parte 1):

```bash
node dist/whatsapp/worker-main.js
```

Espere `worker do WhatsApp em execução`.

## 5. Vincular seu número

1. No painel, **Configurações** → gere um código.
2. Mande só o código (6 caracteres) pelo WhatsApp para o número do bot.
3. Recebe a confirmação.

O código vale 15 minutos; gerar um novo invalida o anterior.

⚠️ Número não vinculado nunca chega ao agente — é a fronteira de autorização do
bot, não um bug.

## 6. Conversar

`quanto vendemos no mês passado?` · `qual produto mais vendeu?` ·
`quantos pedidos foram cancelados este mês?`

---

# Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `Configuração inválida — DATABASE_URL: Required…` | `.env` não carregado neste terminal | Passo 3 |
| Prisma: `Environment variable not found: DATABASE_URL` | Idem | Passo 3 |
| `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "prisma" not found` | Mensagem enganosa do pnpm — o Prisma rodou e falhou por outro motivo | Leia o erro logo acima |
| `Command "db:seed" not found` / *"a sintaxe do nome do arquivo… está incorreta"* | Você está na raiz | `cd apps/api` |
| `ERR_MODULE_NOT_FOUND … config.js` | Usou `pnpm dev` na `apps/api` | Use `pnpm -w build` + `pnpm start` |
| `ERR_MODULE_NOT_FOUND … scripts/lib/….js` | Script rodado via `pnpm`, não pelo compilado | `node dist/scripts/<nome>.js` |
| `Can't reach database server` | Docker parado | `docker compose up -d` |
| `migrate deploy`: `P3018` com `rode migrate-to-multitenant antes desta migração` (ou `P3009` depois) | Banco de antes do multi-tenant | [Banco local de antes do multi-tenant](#banco-local-de-antes-do-multi-tenant) |
| Página do módulo "A equipe Blan está configurando…" ou card "Aguardando configuração" (API: 409 `integration_pending`) | A integração da fonte não está pronta (ex.: GA4 sem `propertyId`, ou credencial recusada) | Back-office → Integrações (Parte 2); no `org_dev`, passo 6 |
| Cards em `fonte de dados indisponível` (vermelho; API: 502) | A fonte externa falhou (ex.: a service account sem acesso à propriedade GA4) | Confira o acesso na fonte; em dev, `MOCK_EXTERNAL_APIS="true"` |
| Aviso "Dados da loja atualizados até…" | A última tentativa de sync falhou (Uappi fora do ar, timeout). Os dados continuam na tela | Detalhe em `SyncState.lastError` (back-office ou `health-report`); o sync tenta de novo sozinho |
| Tudo em `Sem dados no período` | Banco vazio ou período errado | Passo 6, depois passo 8 |
| `seed-demo` (ou o sync de um cliente novo) termina com 0 pedidos | Fixtures de julho/2026 fora da janela do backfill (90 dias) | `SYNC_BACKFILL_DAYS=730` e o `DELETE FROM "SyncState" WHERE ...` do passo 6 |
| Sync não grava nada | Cliente sem integração de e-commerce (COMMERCE) configurada, ou sync worker parado | Back-office → Integrações; `pnpm start:sync` (passo 7) |
| PowerShell: `relation "syncstate" does not exist` | Aspas duplas internas removidas ao chamar o `docker` | Use a forma here-string (`@' ... '@ \| docker compose exec -T ...`) |
| PowerShell: `Unknown options: 'coverage'` | O `pnpm.ps1` engoliu o `--` | `pnpm test '--' --coverage` |
| Testes: `Recusado: DATABASE_URL aponta para o banco "center"` | `DATABASE_URL` de dev (ou nenhuma) no terminal | [Rodar os testes](#rodar-os-testes) |
| Back-office: erro de CORS / "Failed to fetch" | API fora do ar, `VITE_API_URL` errada ou `BACKOFFICE_ORIGIN` diferente da URL do console | Confira os três; origem padrão `http://localhost:5174` |
| Back-office: 429 ao informar o TOTP | 5 códigos errados bloqueiam o operador por 15 min | Aguarde, ou zere o TOTP em dev (Parte 2, passo 2) |
| "Visualizar painel" abre uma página que não carrega | Painel em dev (5173) parado | `pnpm --filter @center/web dev` ou `PANEL_ORIGIN=http://localhost:3333` (Parte 2, passo 9) |
| Admin recebe 403 `password_change_required` | Senha provisória ainda não trocada | `POST /auth/password` (o painel pede a troca no login) |
| Troca de senha: 400 `a nova senha precisa ser diferente da senha atual` | Nova senha igual à atual (ou à provisória) | Escolha outra |
| 401 logo depois de trocar a senha em outra aba | A troca encerra as outras sessões do usuário | Entre de novo |
| `create-operator`: `recusado: …` | E-mail já cadastrado ou dados inválidos | Leia a mensagem; o script não altera nada |
| Bot responde "não encontrei este número" | Número não vinculado | Parte 3, passo 5 |
| Bot só responde o fallback | `ANTHROPIC_API_KEY` inválida | Veja o log do worker |
| `131030 Recipient phone number not in allowed list` | Antes da revisão do app a Meta só entrega a números de teste | Adicione o seu em Configuração da API |

## ⚠️ Scripts quebrados no Node 22

`health:report`, `warm:cache`, `eval:agent` e `seed:demo`
usam `--experimental-strip-types`, que não remapeia `./x.js` para o `.ts` irmão
— morrem com `ERR_MODULE_NOT_FOUND`. Use sempre o compilado:

| Em vez de | Use |
|---|---|
| `pnpm health:report` | `node dist/scripts/health-report.js` |
| `pnpm warm:cache` | `node dist/scripts/warm-cache.js` |
| `pnpm eval:agent` | `node dist/scripts/eval-agent.js` |
| `pnpm seed:demo` | `node dist/scripts/seed-demo.js` |
| `pnpm dev` / `dev:sync` / `dev:whatsapp` | `pnpm start` / `start:sync` / `start:whatsapp` |

`pnpm db:seed` é a exceção e funciona: importa de `dist/`, não de um `.ts` irmão.

---

# Referência

```bash
node dist/scripts/health-report.js   # sync parado? fila crescendo? modo mock?
pnpm -w build                        # compila tudo
docker compose down                  # derruba
docker compose down -v               # derruba e APAGA os dados
```

Testes: [Rodar os testes](#rodar-os-testes) (nunca contra o banco de dev).

Ver usuários e operadores do banco (a senha é hash `scrypt`, **não é recuperável**):

```bash
docker compose exec postgres psql -U center -d center \
  -c 'SELECT email, name, role, "organizationId" FROM "User";' \
  -c 'SELECT email, name, active, "totpEnabledAt" FROM "PlatformOperator";'
```

```powershell
@'
SELECT email, name, role, "organizationId" FROM "User";
SELECT email, name, active, "totpEnabledAt" FROM "PlatformOperator";
'@ | docker compose exec -T postgres psql -U center -d center
```

## Mock vs. real

| | Mock (`"true"`) | Real (`"false"`) |
|---|---|---|
| Uappi, GA4, BigQuery | Fixtures locais, sem rede | Credenciais reais (configuradas pela Blan no back-office) |
| Painel | Funciona | Funciona |
| Agente do WhatsApp | Precisa de chave Anthropic real | Precisa de chave Anthropic real |

Os números em modo mock são **inventados** — não use nenhum deles para conferir
negócio. O `health-report` avisa quando você está em modo mock justamente por
isso.

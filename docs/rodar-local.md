# Rodar o projeto localmente

> Arquitetura multi-tenant e modular: design em [`superpowers/specs/2026-10-29-multi-tenant-modular-design.md`](superpowers/specs/2026-10-29-multi-tenant-modular-design.md); regras para quem desenvolve no `CLAUDE.md` da raiz.

Do zero a um painel preenchido. Tudo aqui foi executado neste repositório; os
⚠️ marcam armadilhas reais, não hipóteses.

## Pré-requisitos

| Ferramenta | Versão |
|---|---|
| Node.js | 22 LTS |
| pnpm | 9.x |
| Docker Desktop | qualquer recente |

Postgres e Redis sobem via Docker — não instale nenhum dos dois.

---

# Parte 1 — Painel

## 1. Subir banco e cache

```bash
docker compose up -d
docker compose ps          # os dois devem estar "Up (healthy)"
```

## 2. Criar o `.env`

```bash
cp .env.example .env
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
UAPPI_BASE_URL="https://api.uappi.com.br"
GA4_CREDENTIALS_JSON=""
ANTHROPIC_API_KEY="placeholder"
```

⚠️ **`OPERATOR_JWT_SECRET` é obrigatória**: é
o segredo dos tokens dos operadores da Blan no back-office. Precisa de 32+
caracteres e **não pode ser igual** ao `JWT_SECRET` — sem ela, ou igual a ele,
a API, o sync e os scripts não sobem. Gere com `openssl rand -hex 32`.

⚠️ `JWT_SECRET` e `PII_PEPPER` precisam de 32+ caracteres;
`CREDENTIALS_ENCRYPTION_KEY` de exatamente 64 hex (`openssl rand -hex 32`).
O `.env.example` traz `CREDENTIALS_ENCRYPTION_KEY` vazia, e vazia a API não sobe.

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

<details>
<summary>PowerShell</summary>

```powershell
Set-Location apps\api
Get-Content ..\..\.env | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item -Path "env:$($name.Trim())" -Value $value.Trim('"', ' ')
}
```
</details>

⚠️ **Nada neste projeto lê o `.env` sozinho** — nem a API, nem o Prisma (ele
procura em `apps/api/`, e o nosso está na raiz). Sem isso você recebe
`Environment variable not found: DATABASE_URL`.

⚠️ Vale **só para o terminal atual**. Cada terminal novo (API, sync, worker)
precisa repetir este passo.

## 4. Instalar, migrar e compilar

```bash
pnpm install
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm -w build
```

⚠️ Fique em `apps/api` daqui até o fim da Parte 1 — `db:seed`, `start` e
`start:sync` só existem nesse pacote. O `-w` alcança a raiz do workspace sem te
mover de pasta.

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

O operador entra no back-office (Parte 2), onde o TOTP é cadastrado no primeiro
login.

## 6. Popular os dados

```bash
SYNC_BACKFILL_DAYS=730 node dist/scripts/seed-demo.js
```

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
Por isso o `SYNC_BACKFILL_DAYS=730` acima. Se você já rodou sem ele, zere o
estado de sync do banco local e repita:

```bash
docker compose exec postgres psql -U center -d center -c 'DELETE FROM "SyncState";'
```

⚠️ Recusa se `MOCK_EXTERNAL_APIS` não for `"true"`, e nunca sobrescreve
integração já configurada. Pode rodar duas vezes sem duplicar nada.

## 7. Subir a API

```bash
pnpm start
```

Painel em **http://localhost:3333**. Confira com
`curl http://localhost:3333/health`.

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

Os dois estados vazios significam coisas diferentes:

| No card | Significado |
|---|---|
| `fonte de dados indisponível` (vermelho) | A consulta **falhou** — a integração do cliente está ausente ou com erro |
| `Sem dados no período selecionado` | A consulta **funcionou** e voltou vazia — falta dado ou o período não cobre |

---

# Parte 2 — Back-office: primeiro acesso

O back-office é o console da equipe Blan. É aqui que se cria o cliente, se
ativam os módulos, se configuram as integrações (credenciais, propriedades GA4,
board do Monday) e se cria o primeiro Admin. O cliente nunca vê credenciais.

Pré-requisito: API no ar (Parte 1, passo 7) e
`pnpm --filter @center/backoffice dev` rodando em **http://localhost:5174**.

1. **Login.** Entre com `operator@center.local` / `center-dev-123` (o operador
   do `db:seed`) ou com o operador criado pelo `create-operator`.
2. **TOTP no primeiro login.** A tela mostra um QR code e o segredo; cadastre-os
   num app autenticador e informe o código de 6 dígitos. Nos logins seguintes
   só o código é pedido. Cinco códigos errados bloqueiam o operador por 15
   minutos.
3. **Criar o cliente.** Em **Clientes**, informe o nome (o slug é gerado, ou
   informado e único). O cliente nasce sem módulos e sem integrações.
4. **Módulos.** Na aba **Módulos**, ative os contratados (ex.: `overview` e
   `products`). Módulo em vigor sem a integração que ele exige aparece como
   "aguardando configuração".
5. **Integrações.** Na aba **Integrações**, configure as do cliente (Uappi com
   `apiKey`/`secretKey`, GA4, lojas de apps, board do Monday). Segredos são
   cifrados e nunca voltam pela API. A aba mostra também o snippet de
   atribuição para o site da loja ([checkout-attribution.md](checkout-attribution.md)).
6. **Primeiro Admin.** Na aba **Usuários**, crie o Admin com e-mail e senha
   provisória (mínimo 12 caracteres). Informe a senha ao cliente por fora: não
   há e-mail no MVP.
7. **Entrar como Admin.** Em http://localhost:5173 (ou 3333) o Admin faz login
   e é obrigado a trocar a senha. Depois cria **Membros** em Usuários, escolhendo
   papel e módulos: um Membro só enxerga os módulos que recebeu.
8. **Conferir.** Um Membro só com `products` vê apenas "Produtos" no menu, e as
   rotas de outros módulos respondem 403 `module_not_available` (por exemplo,
   `POST /api/tools/ga4/traffic_sources` com o token dele).

Para ver o painel como o cliente vê, use **Visualizar painel** na página do
cliente: abre uma sessão **somente leitura** de 30 minutos, com faixa visível e
sem assistente, registrada na auditoria (**Auditoria** no menu).

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

Detalhes em [`whatsapp-setup.md`](./whatsapp-setup.md). Preencha no `.env`:

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
| Cards em `fonte de dados indisponível` (API: 409 `integration_pending`) | O cliente não tem a integração da fonte (ex.: GA4 sem `propertyId`) | Back-office → Integrações (Parte 2); no `org_dev`, passo 6 |
| Tudo em `Sem dados no período` | Banco vazio ou período errado | Passo 6, depois passo 8 |
| `seed-demo` termina com 0 pedidos | Fixtures de julho/2026 fora da janela do backfill (90 dias) | `SYNC_BACKFILL_DAYS=730` e, se já rodou, `DELETE FROM "SyncState";` (passo 6) |
| Sync não grava nada | Cliente sem integração de e-commerce (COMMERCE) configurada — o agendador a ignora, mesmo em mock | Back-office → Integrações, ou passo 6 no `org_dev` |
| Back-office: erro de CORS / "Failed to fetch" | API fora do ar, `VITE_API_URL` errada ou `BACKOFFICE_ORIGIN` diferente da URL do console | Confira os três; origem padrão `http://localhost:5174` |
| Back-office: 429 ao informar o TOTP | 5 códigos errados bloqueiam o operador por 15 min | Aguarde |
| Admin recebe 403 `password_change_required` | Senha provisória ainda não trocada | `POST /auth/password` (o painel pede a troca no login) |
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
pnpm test                            # suíte inteira
pnpm -w build                        # compila tudo
docker compose down                  # derruba
docker compose down -v               # derruba e APAGA os dados
```

Ver usuários e operadores do banco (a senha é hash `scrypt`, **não é recuperável**):

```bash
docker compose exec postgres psql -U center -d center \
  -c 'SELECT email, name, role, "organizationId" FROM "User";'   -c 'SELECT email, name, active, "totpEnabledAt" FROM "PlatformOperator";'
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


# CRMF — Spec de implementação (fase 1)

Nov 25, 2026 · @Antonio Fonseca

## 1. Contexto e escopo

O CRMF é um dashboard operacional multitenant para redes de farmácias: um agente instalado em cada filial extrai vendas do ERP local, envia para a nuvem, e a plataforma exibe mix de vendas, lucratividade, CMV e outros indicadores por rede, loja e funcionário. Esta spec orienta um agente de código a criar todos os codebases da fase 1.

**Como usar esta spec.** Implemente na ordem dos marcos da seção 13. Cada marco termina com testes passando e critérios de aceite atendidos. Quando esta spec não decidir algo, escolha a opção mais simples, registre a decisão em `docs/adr/` e siga.

**Escopo da fase 1**

- Agente Windows e updater (Go), com instalador MSI.
- Backend único em Go: API de ingestão, worker e API de aplicação.
- Banco de controle e Postgres analítico com schema e role por tenant.
- Front-end do QG (time interno) e dash web (clientes).
- Infraestrutura Azure em Terraform e pipelines no GitHub Actions.

**Fora de escopo**

- App mobile Pulse (fase 2). A fase 1 deixa prontos: API única, resumo "hoje" por loja, heartbeat que distingue loja offline de loja sem vendas, e o módulo `pulse` previsto nos planos.
- Notificações push e motor de regras de alerta.
- Conectores para ERPs além do Linx Big.
- Qualquer dado que identifique o cliente final (CPF, nome, telefone). Nunca extrair.

**Piloto:** uma rede com 3 lojas, ERP Linx Big sobre MariaDB, instalação manual do agente.

## 2. Decisões fechadas e stack

Todo o backend e o agente são Go; todas as telas são React com TypeScript; a nuvem é Azure, descrita em Terraform. Não trocar nenhuma tecnologia desta tabela sem um ADR.

| Componente | Tecnologia | Observação |
| --- | --- | --- |
| Agente e updater | Go, `golang.org/x/sys/windows/svc`, `modernc.org/sqlite`, `go-sql-driver/mysql`, `parquet-go/parquet-go` | Dois binários, Windows 10/11 e Server 2016+, amd64 e 386 |
| Instalador | WiX Toolset v4, MSI assinado | Instalação silenciosa com código de pareamento |
| Backend (ingestão, worker, aplicação) | Go 1.23+, `chi`, `pgx/v5`, `sqlc`, `riverqueue/river`, x/crypto/argon2, pquerna/otp | Um binário, modo escolhido por flag: `api` ou `worker` |
| Contrato de API | OpenAPI 3.1, `oapi-codegen` (Go) e `openapi-typescript` + `openapi-fetch` (TS) | Contrato é a fonte da verdade |
| Migrações | `pressly/goose` | Controle, tenant e plataforma em pastas separadas |
| Front-ends | React 18, TypeScript, Vite, TanStack Router e Query, pnpm workspaces | Dois apps e pacotes compartilhados |
| Gráficos | Apache ECharts via `echarts-for-react` | Componentes encapsulados no pacote `charts` |
| Infraestrutura | Terraform (provider `azurerm`), estado remoto em Blob Storage | Ambientes `hml` e `prd` |
| CI/CD | GitHub Actions, OIDC para Azure | Sem segredo de nuvem no repositório |
| Observabilidade | OpenTelemetry, Azure Monitor / Application Insights | Logs estruturados com `slog` |

**Serviços gerenciados:** Azure Container Apps (API e worker), Azure Database for PostgreSQL Flexible Server (bancos `crmf_control` e `crmf_analytics`), Azure Blob Storage (bruto), Azure Static Web Apps (front-ends), Azure Key Vault (segredos e chaves), Azure Communication Services Email (convites e redefinição de senha), gateway de cobrança com Pix e boleto via webhook.

**Princípios de arquitetura**

1. Agente burro, centro inteligente: o agente extrai e envia; toda transformação acontece no worker.
2. Tenant definido pela credencial, nunca pelo conteúdo de um arquivo ou de um parâmetro do cliente.
3. Bruto imutável no bucket: todo dado pode ser reprocessado sem voltar à loja.
4. Telas leem só tabelas agregadas; nenhuma tela consulta o fato bruto.
5. Plano é dado, não código: limites e módulos vêm do banco de controle.

&#91;embedded content: arquitetura da fase 1 · loja, plataforma e telas\]

O agente fala com a API de ingestão para controle e envia o arquivo direto ao Blob Storage; o worker processa e é o único a gravar no Postgres analítico; uma única API de aplicação serve as telas.

## 3. Estrutura do monorepo

Um único repositório `crmf`, com um módulo Go na raiz e um workspace pnpm em `web/`. O agente e o backend compartilham pacotes em `internal/shared` (formato de lote, manifesto de OTA, assinatura).

```
crmf/
  go.mod                      módulo github.com/<org>/crmf
  cmd/
    agent/                    agent.exe (serviço CRMFAgent)
    updater/                  updater.exe (serviço CRMFUpdater)
    server/                   backend: server api | server worker | server migrate
    crmfctl/                  CLI interna: gerar chaves, assinar release, criar tenant local
  internal/
    shared/                   usado por agente e backend
      batch/                  manifesto de lote, nomes de arquivo, checksums
      release/                manifesto de OTA, verificação Ed25519
      apiclient/              cliente da API de ingestão (gerado + wrappers)
    agent/
      config/  extract/  spool/  state/  upload/  heartbeat/  winsvc/  dpapi/
    updater/
      svcctl/  install/  rollback/
    server/
      httpapi/                handlers gerados (oapi-codegen) e middlewares
      ingest/                 pareamento, config, lotes, releases
      app/                    indicadores, escopo, QG
      worker/                 jobs River: process_batch, reconcile, rollup, sweep
      tenancy/                criação de schema e role, pool por tenant
      auth/                   senhas, sessões, MFA, convites, grants, token de dispositivo
      billing/                webhook do gateway
      storage/                Blob Storage, SAS
      db/core/  db/auth/  db/analytics/   consultas sqlc (db/auth só é importado por auth/)
  migrations/
    control/  tenant/  platform/
  connectors/
    linxbig/                  queries de extração versionadas (YAML + SQL)
  api/
    ingest.openapi.yaml
    app.openapi.yaml
  web/
    package.json  pnpm-workspace.yaml
    apps/hq/                  QG
    apps/dash/                dash web
    packages/ui/              design system CRMF
    packages/api-client/      clientes gerados dos dois contratos
    packages/charts/          wrappers ECharts
    packages/auth/            login, MFA, convite, redefinição de senha e contexto de escopo
  installer/                  WiX (.wxs), scripts de assinatura
  infra/
    modules/  envs/hml/  envs/prd/
  deploy/                     Dockerfile do backend
  docs/adr/  docs/runbooks/
  .github/workflows/
  Makefile
```

**Convenções**

- Go: `gofmt`, `golangci-lint` com configuração no repositório, erros embrulhados com `%w`, `context.Context` em toda função que faz I/O, sem variáveis globais mutáveis.
- SQL: `snake_case`, chaves `uuid` (v7) nas tabelas de controle, `bigint` identity nas tabelas de fatos, timestamps `timestamptz` em UTC, valores monetários `numeric(14,4)`.
- TypeScript: `strict`, ESLint e Prettier, nenhum `any` sem comentário justificando.
- Commits no padrão Conventional Commits; um PR por tarefa; CI verde obrigatório.
- `make` como ponto único: `make dev`, `make test`, `make gen` (sqlc + oapi-codegen + openapi-typescript), `make agent` (cross-compile Windows), `make lint`.
- Ambiente local com `docker compose`: Postgres 16, MariaDB 10.6 com base Linx Big de teste, Azurite (emulador do Blob Storage) e Mailpit (captura os e-mails de convite e redefinição de senha).
- Textos de interface em português do Brasil; código, nomes e comentários em inglês.

## 4. Banco de controle (`crmf_control`)

O banco de controle guarda tudo que não é dado de venda: tenants, planos, lojas, dispositivos, lotes, versões e usuários. Só o backend acessa; nenhum dado de venda entra aqui. As tabelas abaixo são o mínimo; colunas `created_at` e `updated_at` estão implícitas em todas.

**Schemas e roles.** O banco tem dois schemas: `auth` (identidade, sessões e grants) e `core` (todo o resto). Cada schema tem seu role de aplicação, e o backend abre um pool de conexão por role.

| Role | Acesso | Usado por |
| --- | --- | --- |
| `crmf_auth` | Leitura e escrita em `auth.*`; leitura em `core.tenants` e `core.stores`; `INSERT` em `core.audit_log` | Só o pacote `internal/server/auth` |
| `crmf_core` | Leitura e escrita em `core.*`, exceto `audit_log`, onde só faz `INSERT`; nenhum acesso a `auth` | API, worker e demais pacotes |
| `crmf_migrator` | Dono dos dois schemas | `server migrate` |

- Os demais módulos obtêm identidade e grants só pela interface do pacote `auth` (`auth.Principal(ctx)`), nunca por SQL.
- Nenhum role de aplicação faz `UPDATE` ou `DELETE` em `core.audit_log`.
- Um teste de integração confirma que `crmf_core` recebe erro de permissão ao ler `auth.users`.

```sql
create schema core;
create schema auth;
set search_path = core;                    -- tabelas sem prefixo ficam em core

create table plans (
  id uuid primary key, code text unique not null, name text not null,
  price_cents int not null, active bool not null default true,
  sync_interval_seconds int not null,      -- 180, 3600, 86400
  max_stores int, max_users int,           -- null = ilimitado
  history_months int not null,
  modules text[] not null                  -- 'core','realtime','export','pulse'
);

create table tenants (
  id uuid primary key, slug text unique not null,   -- [a-z0-9_]{3,40}
  legal_name text not null, cnpj text unique not null,
  status text not null,                    -- trial|active|suspended|cancelled
  schema_name text unique not null,        -- t_<slug>
  db_role text unique not null,            -- r_<slug>
  schema_version bigint not null default 0,
  require_mfa bool not null default false  -- definido pelo network_admin
);

create table subscriptions (
  id uuid primary key, tenant_id uuid not null references tenants,
  plan_id uuid not null references plans,
  status text not null,                    -- trialing|active|past_due|suspended|cancelled
  overrides jsonb not null default '{}',   -- mesmas chaves do plano
  gateway text, gateway_customer_id text, gateway_subscription_id text,
  current_period_end date, grace_until date
);

create table stores (
  id uuid primary key, tenant_id uuid not null references tenants,
  code text not null, name text not null, cnpj text,
  city text, uf char(2), timezone text not null default 'America/Sao_Paulo',
  erp text not null default 'linx_big', status text not null,  -- active|inactive
  unique (tenant_id, code)
);

create table pairing_codes (
  code_hash bytea primary key, store_id uuid not null references stores,
  expires_at timestamptz not null, used_at timestamptz
);

create table devices (
  id uuid primary key, tenant_id uuid not null references tenants,
  store_id uuid not null references stores,
  public_key bytea not null,               -- Ed25519 do dispositivo
  status text not null,                    -- active|revoked
  agent_version text, updater_version text, target_agent_version text,
  os_version text, erp_version text, arch text,
  last_heartbeat_at timestamptz, last_batch_at timestamptz,
  last_error text, paired_at timestamptz not null, revoked_at timestamptz
);

create table batches (
  id uuid primary key, tenant_id uuid not null, store_id uuid not null,
  device_id uuid not null references devices,
  track text not null,                     -- hot|cold
  stream text not null,                    -- sales|products|stock|sellers|...
  connector_version text not null,
  blob_path text not null, sha256 text not null, size_bytes bigint not null,
  row_count int not null, window_from timestamptz, window_to timestamptz,
  status text not null,                    -- announced|uploaded|processing|processed|failed|quarantined
  attempts int not null default 0, error text,
  processed_at timestamptz,
  unique (device_id, sha256)               -- idempotência
);
create index on batches (tenant_id, store_id, created_at desc);

create table releases (
  id uuid primary key, component text not null,  -- agent|updater
  version text not null, arch text not null,     -- amd64|386
  sha256 text not null, signature bytea not null, blob_path text not null,
  status text not null,                          -- draft|published|withdrawn
  unique (component, version, arch)
);

create table release_failures (
  device_id uuid references devices, version text, reason text,
  failed_at timestamptz not null, primary key (device_id, version)
);

create table connector_configs (
  id uuid primary key, erp text not null, version text not null,
  spec jsonb not null,                     -- streams, queries, agenda
  status text not null,                    -- draft|active|retired
  unique (erp, version)
);

create table auth.users (
  id uuid primary key,
  email citext unique not null, name text not null,
  status text not null,                    -- invited|active|disabled
  password_hash text,                      -- argon2id em formato PHC; null até aceitar o convite
  password_changed_at timestamptz,
  mfa_enabled_at timestamptz,
  failed_logins int not null default 0, locked_until timestamptz,
  last_login_at timestamptz
);

-- Credenciais públicas e metadados são selados com AES-256-GCM (Key Vault).
-- A chave privada permanece no autenticador; AAD vincula usuário, realm e ID.
create table auth.passkey_credentials (
  credential_id bytea primary key,
  user_id uuid not null references auth.users,
  realm text not null,                     -- platform|tenant
  credential_enc bytea not null,           -- registro WebAuthn completo, incluindo contador e flags
  created_at timestamptz not null, updated_at timestamptz not null
);

create table auth.passkey_challenges (
  token_hash bytea primary key,             -- SHA-256 do token opaco do cookie de desafio
  user_id uuid not null references auth.users,
  realm text not null, kind text not null,  -- enroll|verify
  session_enc bytea not null,              -- challenge, handle, RP ID, UV e expiração selados
  attempts int not null default 0,
  created_at timestamptz not null, expires_at timestamptz not null, used_at timestamptz
);

create table auth.user_sessions (
  id uuid primary key, user_id uuid not null references auth.users,
  token_hash bytea unique not null,        -- SHA-256 do token opaco
  realm text not null,                     -- platform|tenant
  mfa_verified bool not null default false,
  ip inet, user_agent text,
  last_seen_at timestamptz not null, idle_expires_at timestamptz not null,
  expires_at timestamptz not null, revoked_at timestamptz
);

create table auth.user_tokens (
  token_hash bytea primary key, user_id uuid not null references auth.users,
  kind text not null,                      -- invite|password_reset
  expires_at timestamptz not null, used_at timestamptz
);

create table auth.mfa_recovery_codes (
  user_id uuid not null references auth.users, code_hash text not null,
  used_at timestamptz, primary key (user_id, code_hash)
);

create table auth.user_grants (
  id uuid primary key, user_id uuid not null references auth.users,
  role text not null,     -- platform_admin|platform_support|network_admin|store_manager|employee
  tenant_id uuid references core.tenants,  -- null só para papéis platform_*
  store_id uuid references core.stores,    -- obrigatório para store_manager e employee
  seller_code text                         -- liga employee ao vendedor no ERP
);

create table billing_events (
  id text primary key,                     -- id do evento no gateway
  tenant_id uuid, type text not null, payload jsonb not null,
  processed_at timestamptz
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid, actor_device_id uuid, tenant_id uuid,
  action text not null, target text, detail jsonb, at timestamptz not null
);
```

**Regras**

- Limite efetivo de um tenant = valores do plano sobrescritos por `subscriptions.overrides`. Calcular sempre por uma função única `EffectiveLimits(tenantID)` no backend.
- `tenants.slug` é imutável após a criação, porque nomeia schema e role.
- Assinatura `suspended` bloqueia login e API de aplicação do tenant, mas mantém a ingestão até `grace_until` (padrão: 30 dias após a suspensão). Depois disso a API de ingestão recusa lotes com `402`.
- Toda ação do QG que altera tenant, assinatura, loja, dispositivo ou release grava em `audit_log`.

## 5. Banco analítico (`crmf_analytics`)

Cada rede tem um schema `t_<slug>` e um role de login `r_<slug>` com permissão apenas no próprio schema. A visão global do QG lê só o schema `platform`, que recebe agregados por loja e dia, nunca linhas de venda.

### 5.1 Roles e conexões

| Role | Tipo | Permissões | Usado por |
| --- | --- | --- | --- |
| `crmf_migrator` | login | Dono de todos os schemas; cria schemas e roles | `server migrate` e criação de tenant |
| `r_<slug>` | login, um por tenant | `USAGE` e DML em `t_<slug>`; nada mais | Worker e API de aplicação, dentro do tenant |
| `crmf_platform_writer` | login | `INSERT`/`UPDATE` em `platform.*` | Worker, ao publicar agregados |
| `crmf_platform_reader` | login | `SELECT` em `platform.*` | API de aplicação, rotas do QG |

- Senha de cada `r_<slug>` gerada na criação do tenant e guardada no Key Vault como `pg-tenant-<slug>`, substituindo `_` por `-` apenas no nome do segredo (Key Vault não aceita `_`; a transformação é injetiva porque slugs não contêm `-`).
- O backend mantém um pool `pgx` por tenant, criado sob demanda (máximo 4 conexões, fechado após 10 minutos ocioso). O pool é obtido por `tenancy.Pool(ctx, tenantID)`, que resolve o tenant pelo contexto autenticado. Não existe função que receba um nome de schema vindo de fora.
- Toda conexão de tenant fixa `search_path = t_<slug>` na abertura. `PUBLIC` perde todos os privilégios no banco e no schema `public`.

### 5.2 Modelo canônico (por schema de tenant)

O modelo canônico é independente de ERP: o conector Linx Big mapeia para ele no worker. Chave de produto entre lojas = EAN/GTIN; quando faltar, usar o código interno do ERP.

```sql
-- dimensões
create table dim_product (
  product_key bigint generated always as identity primary key,
  erp_product_id text unique not null, ean text, description text not null,
  manufacturer text, category text, subcategory text,
  is_generic bool, is_controlled bool, active bool not null default true,
  updated_at timestamptz not null
);
create index on dim_product (ean);

create table dim_seller (
  store_id uuid not null, seller_code text not null, name text not null,
  active bool not null default true, primary key (store_id, seller_code)
);

-- fato principal, particionado por mês de business_date
create table fact_sale_item (
  store_id uuid not null, sale_id text not null, item_seq int not null,
  business_date date not null, sold_at timestamptz not null,
  product_key bigint not null references dim_product,
  seller_code text,
  quantity numeric(14,4) not null,
  gross_amount numeric(14,4) not null,     -- preço × quantidade
  discount_amount numeric(14,4) not null,
  net_amount numeric(14,4) not null,       -- gross - discount
  cost_amount numeric(14,4) not null,      -- custo do item vendido (CMV)
  status text not null,                    -- sold|cancelled|returned
  source_batch_id uuid not null, loaded_at timestamptz not null,
  primary key (store_id, business_date, sale_id, item_seq)
) partition by range (business_date);

create table fact_stock_daily (
  store_id uuid not null, snapshot_date date not null,
  product_key bigint not null references dim_product,
  quantity numeric(14,4) not null, unit_cost numeric(14,4),
  primary key (store_id, snapshot_date, product_key)
) partition by range (snapshot_date);

-- staging: uma linha por registro de lote, truncada após processar
create unlogged table stg_rows (
  batch_id uuid not null, stream text not null, payload jsonb not null
);
```

- Partições mensais criadas com 3 meses de antecedência por um job diário. Partições além de `history_months` do plano são desanexadas e removidas por job mensal.
- `seller_code` é o código do vendedor no ERP. Nenhuma coluna guarda CPF, nome ou contato de cliente final.

### 5.3 Agregados (lidos pelas telas)

| Tabela | Grão | Medidas |
| --- | --- | --- |
| `agg_store_day` | loja, dia | faturamento bruto e líquido, desconto, CMV, margem, cupons, itens, cancelamentos, devoluções |
| `agg_store_hour` | loja, dia, hora | faturamento líquido, cupons |
| `agg_store_product_day` | loja, dia, produto | quantidade, líquido, CMV, margem |
| `agg_store_category_day` | loja, dia, categoria, fabricante, genérico | líquido, CMV, margem, quantidade |
| `agg_store_seller_day` | loja, dia, vendedor | líquido, margem, cupons, itens |
| `store_today` | loja | resumo do dia corrente: líquido, cupons, ticket médio, margem, hora da última venda, `data_as_of` |
| `store_targets` | loja, mês | meta de faturamento (digitada no dash) |

Agregados são recalculados pelo worker apenas para as combinações (loja, dia) tocadas por um lote, com `delete` + `insert` dentro da mesma transação.

### 5.4 Definição dos indicadores

Indicadores consideram só itens com `status = 'sold'`; cancelamentos e devoluções são reportados à parte.

| Indicador | Fórmula |
| --- | --- |
| Faturamento líquido | soma de `net_amount` |
| Desconto | soma de `discount_amount`; % = desconto ÷ bruto |
| CMV | soma de `cost_amount` |
| Margem bruta | líquido − CMV; % = margem ÷ líquido |
| Cupons | contagem distinta de (`store_id`, `sale_id`) |
| Ticket médio | líquido ÷ cupons |
| Itens por cupom | soma de `quantity` ÷ cupons |
| Mix | participação de cada categoria, fabricante ou genérico no líquido |
| Curva ABC | produtos ordenados por líquido no período: A até 80% acumulado, B até 95%, C o restante |
| Atingimento de meta | líquido do mês ÷ `store_targets` |
| Cobertura de estoque | estoque em unidades ÷ venda média diária dos últimos 30 dias |

### 5.5 Schema `platform`

```sql
create table platform.tenant_store_day (
  tenant_id uuid not null, store_id uuid not null, business_date date not null,
  net_amount numeric(14,4), cost_amount numeric(14,4), coupons int,
  items numeric(14,4), updated_at timestamptz not null,
  primary key (tenant_id, store_id, business_date)
);
```

O worker grava aqui, com `crmf_platform_writer`, uma cópia de `agg_store_day` reduzida a essas colunas. Nenhuma dimensão de produto ou vendedor vai para `platform` na fase 1.

## 6. Agente Windows e updater

Dois serviços Go independentes: `CRMFAgent` extrai e envia, `CRMFUpdater` atualiza e vigia o agente. Nenhum dos dois abre porta de entrada; toda comunicação é de saída, HTTPS para a API de ingestão e para o Blob Storage.

### 6.1 Instalação e layout

```
C:\Program Files\CRMF\
  updater.exe
  versions\<versão>\agent.exe       no máximo duas versões: atual e anterior
C:\ProgramData\CRMF\
  config.json                      endpoint, device_id, store_id (não sensível)
  secrets.bin                      chave privada e senha do MariaDB, DPAPI escopo máquina
  state.db                         SQLite: cursores, fila de lotes, versão do conector
  spool\                           arquivos Parquet aguardando envio
  logs\                            JSON lines, rotação diária, 14 dias, 50 MB no total
```

- MSI instala os dois serviços com início automático (atrasado) e ações de recuperação: reiniciar após 1 min, 1 min, 5 min.
- `CRMFAgent` roda como conta virtual `NT SERVICE\CRMFAgent`; `CRMFUpdater` roda como `LocalSystem`, porque reconfigura serviços.
- ACL de `C:\ProgramData\CRMF`: leitura e escrita para as duas contas e Administradores; nenhum acesso para usuários comuns.
- Parâmetros do MSI: `PAIRING_CODE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `API_URL` (padrão: produção). Instalação silenciosa: `msiexec /i crmf-agent.msi /qn PAIRING_CODE=... DB_USER=... DB_PASSWORD=...`.
- O instalador testa a conexão com o MariaDB e o pareamento antes de concluir; se falhar, desfaz a instalação e mostra o motivo.
- `docs/runbooks/mariadb-readonly-user.md` documenta a criação do usuário somente leitura no Linx Big (`GRANT SELECT` apenas nas tabelas usadas pelo conector).

### 6.2 Pareamento e autenticação do dispositivo

1. O QG gera um código de pareamento por loja: 8 caracteres, uso único, validade de 72 horas.
2. Na instalação, o agente gera um par de chaves Ed25519, guarda a privada em `secrets.bin` e chama `POST /v1/devices/pair` com o código, a chave pública e dados da máquina. Recebe `device_id`, `store_id` e `tenant_id`.
3. Para cada sessão, o agente pede um desafio (`POST /v1/devices/challenge`), assina o nonce e troca por um token de acesso de 15 minutos (`POST /v1/devices/token`). Esse fluxo não depende do relógio da máquina da loja.
4. Revogar o dispositivo no QG invalida a renovação do token; o agente para em até 15 minutos e reporta `revoked` no log local.
5. Reinstalar uma loja exige novo código; o dispositivo anterior é revogado automaticamente no pareamento do novo.

### 6.3 Configuração e conector

A cada heartbeat a API devolve `config_version`. Quando muda, o agente baixa `GET /v1/devices/config`, que traz:

- `hot_interval_seconds`: intervalo do plano (180, 3600 ou 86400), aplicado com variação aleatória de ±10%.
- `cold_window`: horário local preferido para a trilha fria (padrão 02:00) e `reconcile_days` (padrão 7).
- `connector`: especificação versionada do Linx Big, assinada com a mesma chave Ed25519 das releases. O agente recusa e reporta um conector com assinatura inválida.

Formato da especificação do conector (em `connectors/linxbig/<versão>.yaml`, publicado em `connector_configs`):

```yaml
erp: linx_big
version: 2026.11.1
min_erp_version: "x.y"            # a confirmar no piloto
streams:
  - name: sales_items
    track: hot
    mode: incremental              # incremental | window | full
    cursor: { column: alteracao_em, type: timestamp }   # nomes a confirmar no piloto
    page_size: 5000
    sql: |
      SELECT ... FROM ... WHERE alteracao_em > ? ORDER BY alteracao_em LIMIT ?
  - name: sales_items_reconcile
    track: cold
    mode: window                   # reenvia business_date >= hoje - reconcile_days
    sql: |
      SELECT ... WHERE data_movimento >= ?
  - name: products
    track: cold
    mode: full
    sql: SELECT ...
  - name: sellers
    track: cold
    mode: full
  - name: stock
    track: cold
    mode: full
```

O SQL real das tabelas do Linx Big é escrito no marco M2, depois de inspecionar a base de teste. A especificação nunca seleciona colunas de cliente final; um teste de CI falha se o SQL contiver colunas da lista `connectors/linxbig/forbidden_columns.txt`.

### 6.4 Ciclo de extração

1. Agendador decide a próxima execução por trilha. Só uma extração roda por vez; a trilha quente tem prioridade.
2. Abre conexão com o MariaDB: `SET SESSION TRANSACTION READ ONLY`, isolamento `READ COMMITTED`, timeout de consulta de 60 s.
3. Lê em páginas de `page_size`, escrevendo em fluxo para um arquivo Parquet (compressão zstd) em `spool\tmp\`. Colunas tipadas conforme o resultado da query.
4. Ao terminar, calcula SHA-256, move o arquivo para `spool\ready\` e grava na fila do SQLite, na mesma transação, o lote e o novo valor do cursor. O cursor só avança na fila local; o envio é desacoplado.
5. Para o cursor, usa o maior valor lido, e a próxima leitura repete 2 minutos de sobreposição. Duplicatas são resolvidas pelo upsert do worker.
6. Horário de referência vem de `SELECT NOW()` do MariaDB, nunca do relógio do Windows.
7. Se a trilha fria não rodou por estar desligada no horário, roda assim que o serviço subir.
8. Prioridade de processo `BELOW_NORMAL_PRIORITY_CLASS`.

### 6.5 Envio

1. Para cada lote pronto, `POST /v1/batches` com `stream`, `track`, `sha256`, `size_bytes`, `row_count`, janela e versão do conector. A API devolve `batch_id` e uma URL SAS de escrita, válida por 15 minutos, para um único blob.
2. `PUT` do arquivo na URL SAS.
3. `POST /v1/batches/{id}/complete`. Só depois da resposta `200` o arquivo local é apagado.
4. Falha em qualquer etapa: nova tentativa com espera exponencial (5 s a 15 min, com variação aleatória). Resposta `409` com o mesmo `sha256` = lote já aceito; apagar o arquivo local.
5. Spool limitado a 2 GB (configurável). Acima disso, a extração para, o envio continua, e o heartbeat reporta `spool_full`.

### 6.6 Heartbeat e comandos

`POST /v1/devices/heartbeat` a cada 60 s, mesmo sem lotes, com: versões do agente, updater e conector; versão do Windows e do Linx Big; arquitetura; banco local acessível ou não; último sucesso e último erro por stream; tamanho do spool; uso de disco.

A resposta pode trazer comandos, executados uma vez e confirmados no heartbeat seguinte:

| Comando | Efeito |
| --- | --- |
| `send_diagnostics` | Compacta os logs dos últimos 3 dias e o `state.db` (sem segredos) e envia como lote do stream `diagnostics` |
| `resync_stream` | Zera o cursor de um stream a partir de uma data e reextrai |
| `run_cold_now` | Antecipa a trilha fria |

### 6.7 Updater e OTA

O updater consulta `GET /v1/devices/releases/target` a cada 5 minutos, com o token do dispositivo (o updater lê a mesma chave em `secrets.bin`).

1. Se a versão-alvo do agente difere da instalada e não está em `release_failures` para o dispositivo, baixa o binário da arquitetura correta pela URL SAS do manifesto.
2. Verifica SHA-256 e assinatura Ed25519 com a chave pública embutida no updater em tempo de compilação. Qualquer divergência: descarta e reporta.
3. Grava em `versions\<nova>\agent.exe`, para o serviço do agente (espera até 60 s pela parada limpa), altera o caminho do binário do serviço e o inicia.
4. Espera até 5 minutos por um heartbeat da nova versão com `db_reachable = true`. O agente grava esse sucesso em `state.db`, que o updater consulta.
5. Sem confirmação: volta o caminho do serviço para a versão anterior, reinicia, e registra a falha (`POST /v1/devices/releases/failure`).
6. Com confirmação: reporta sucesso e apaga versões mais antigas que a anterior.
7. O updater também vigia o agente: se o serviço ficar parado por mais de 10 minutos sem atualização em curso, inicia-o e reporta.
8. Atualização do próprio updater: o agente executa o mesmo procedimento sobre o serviço `CRMFUpdater`.

**Compatibilidade do estado local:** toda alteração de estrutura em `state.db` usa migrações aditivas (só adiciona colunas e tabelas). Uma versão nunca pode impedir a anterior de ler o arquivo.

### 6.8 Build e assinatura

- `GOOS=windows`, `GOARCH=amd64` e `386`, `CGO_ENABLED=0`, `-trimpath`, `-ldflags "-s -w -X main.version=<semver>"`.
- Assinatura Authenticode (certificado de código em Key Vault ou serviço de assinatura) em `agent.exe`, `updater.exe` e no MSI.
- Assinatura Ed25519 do binário feita por `crmfctl release sign` no pipeline, com a chave privada vinda de segredo do ambiente de release. A chave privada nunca fica no backend nem no banco.
- Testes do agente rodam em runner `windows-latest`, incluindo instalação e desinstalação do MSI e um ciclo completo de OTA com rollback forçado.

## 7. API de ingestão

A API de ingestão atende só dispositivos: pareamento, token, configuração, heartbeat, lotes e releases. Contrato em `api/ingest.openapi.yaml`, prefixo `/v1`, servida pelo mesmo binário da API de aplicação em host próprio (`ingest.<domínio>`).

### 7.1 Endpoints

| Método e rota | Autenticação | Função |
| --- | --- | --- |
| `POST /v1/devices/pair` | código de pareamento | Registra a chave pública; devolve `device_id`, `store_id`, `tenant_id` |
| `POST /v1/devices/challenge` | `device_id` | Devolve nonce de 32 bytes, válido por 60 s, uso único |
| `POST /v1/devices/token` | nonce assinado | Devolve JWT de 15 min (`sub` = device, claims `tid`, `sid`) |
| `POST /v1/devices/heartbeat` | token | Atualiza estado do dispositivo; devolve `config_version` e comandos |
| `GET /v1/devices/config` | token | Intervalos, janela fria e conector assinado |
| `POST /v1/batches` | token | Anuncia lote; devolve `batch_id` e URL SAS de escrita |
| `POST /v1/batches/{id}/complete` | token | Confirma upload; enfileira processamento |
| `GET /v1/devices/releases/target` | token | Manifesto da versão-alvo do agente e do updater |
| `POST /v1/devices/releases/report` | token | Sucesso ou falha de atualização |

### 7.2 Regras

- `tenant_id` e `store_id` saem sempre das claims do token. Nenhum endpoint aceita esses valores no corpo ou na URL.
- `POST /v1/batches` recusa com `429` e `Retry-After` quando o stream quente do dispositivo anuncia lotes antes de `hot_interval_seconds × 0,8` desde o último aceito. Streams frios e `diagnostics`: no máximo 10 lotes por hora.
- Tamanho máximo de lote: 256 MB. Lotes maiores são recusados com `413`; o agente divide por páginas.
- Caminho do blob, definido só pelo servidor: `raw/<tenant_id>/<store_id>/<stream>/<yyyy>/<mm>/<dd>/<batch_id>.parquet`.
- SAS: escrita, um blob, 15 minutos, HTTPS apenas, gerada com user delegation key (sem chave de conta).
- `complete` confere no Blob Storage que o arquivo existe e tem o tamanho anunciado; o SHA-256 é recalculado pelo worker. Marca `uploaded` e cria o job `process_batch` na mesma transação do banco de controle.
- Assinatura `suspended` além de `grace_until` ou tenant `cancelled`: `402` em `batches`; heartbeat continua aceito.
- Dispositivo revogado: `401` em tudo.
- Toda resposta de erro segue `application/problem+json`.
- Limite global por dispositivo: 120 requisições por minuto.

### 7.3 Varredura

Job `sweep_batches` a cada 10 minutos: lotes `announced` há mais de 1 hora são verificados no Blob Storage. Se o arquivo existe, segue como `uploaded`; se não, marca `failed` com motivo `upload_missing`. O agente reenviará se ainda tiver o arquivo.

## 8. Worker

O worker é o único componente que escreve no banco analítico. Roda como `server worker`, consome jobs River armazenados no banco de controle e processa um lote quente em até 60 s (p95) depois do `complete`.

### 8.1 Jobs

| Job | Gatilho | Função |
| --- | --- | --- |
| `process_batch` | `complete` de um lote | Valida, carrega, agrega, publica em `platform` |
| `sweep_batches` | a cada 10 min | Resolve lotes anunciados e não confirmados (seção 7.3) |
| `partition_maintenance` | diário, 03:30 | Cria partições dos próximos 3 meses em todos os tenants |
| `retention` | mensal | Remove partições além de `history_months` |
| `reprocess` | manual, pelo QG | Reenfileira lotes de um tenant ou loja num intervalo de datas a partir do bruto |
| `provision_tenant` | criação de tenant | Cria role, schema, aplica migrações, guarda a senha no Key Vault |
| `migrate_tenants` | deploy com migração nova | Aplica migrações de tenant pendentes, um tenant por vez |

`provision_tenant` roda no processo privilegiado separado `server provisioner`,
consumindo a fila River `provision` no schema `jobs` do controle. API e worker
comum não recebem credenciais de migração nem escrita no cofre de tenants.
A reserva da rede, intenção com ator autenticado, job e auditoria são atômicos
no controle; prontidão só é publicada após schema, role e migrações verificados.
Veja [QG Redes](docs/implementation/hq-networks.md) para limites e reexecução.

### 8.2 `process_batch`, passo a passo

1. Marca o lote `processing` e incrementa `attempts`.
2. Obtém um advisory lock por (tenant, loja): lotes da mesma loja são processados em série, na ordem de `created_at`.
3. Baixa o blob e recalcula o SHA-256. Divergência: copia para `quarantine/` com o mesmo caminho relativo, marca `quarantined`, sem novas tentativas.
4. Lê o Parquet e valida colunas e tipos contra o mapeador da versão do conector (`internal/server/worker/mappers/linxbig/v<versão>`). Versão desconhecida ou colunas faltando: `quarantined`.
5. Abre transação com o pool do tenant e carrega as linhas em `stg_rows` via `COPY`.
6. Aplica o modo do stream:
   - `incremental` (vendas quentes): upsert em `fact_sale_item` pela chave primária; upsert de produtos e vendedores desconhecidos com dados mínimos.
   - `window` (reconciliação): apaga os itens da loja nas datas de `window_from` a `window_to` e insere o conteúdo do lote. A janela termina ontem; o dia corrente pertence só à trilha quente.
   - `full` (cadastros e estoque): upsert em `dim_product` e `dim_seller`; produtos ausentes no lote viram `active = false`; estoque grava o snapshot do dia.
7. Coleta as combinações (loja, `business_date`) tocadas e recalcula os agregados da seção 5.3 só para elas; atualiza `store_today` se o dia corrente foi tocado.
8. Esvazia `stg_rows` do lote e confirma a transação.
9. Em conexão separada, com `crmf_platform_writer`, faz upsert de `platform.tenant_store_day` para as mesmas combinações.
10. Marca o lote `processed`, grava `row_count` efetivo e atualiza `devices.last_batch_at`.

Erros transitórios (banco, rede): até 5 tentativas com espera exponencial; depois `failed` com a mensagem em `error`. Processar o mesmo lote duas vezes produz o mesmo resultado.

### 8.3 Mapeador Linx Big

- Funções puras `Map<Stream>(row) (Canonical, error)` com testes de tabela a partir de amostras reais anonimizadas da base de teste.
- `business_date` = data do movimento no ERP no fuso da loja (`stores.timezone`).
- `cost_amount`: custo do item gravado na venda, se o Linx Big o registrar; caso contrário, custo médio do produto na data. A regra escolhida fica em ADR após inspeção da base no marco M2.
- Status: venda cancelada → `cancelled`; devolução → `returned` com quantidades e valores positivos.

### 8.4 Retenção do bruto

Política de ciclo de vida do Blob Storage: `raw/` vai para camada fria após 30 dias e é apagado após 400 dias; `quarantine/` é apagado após 90 dias; `diagnostics/` após 30 dias. O worker nunca apaga blobs.

## 9. API de aplicação

Uma API serve o QG e o dash; o que muda entre eles é o escopo do usuário. Contrato em `api/app.openapi.yaml`, prefixo `/v1`, host `api.<domínio>`. Rotas de cliente ficam em `/v1/...`; rotas do QG em `/v1/hq/...`.

### 9.1 Autenticação própria

Autenticação e autorização são próprias: e-mail e senha, MFA por passkeys/WebAuthn e sessões guardadas no banco de controle, sem provedor externo de identidade. Tudo fica em `internal/server/auth`.

- **Senhas:** argon2id (`golang.org/x/crypto/argon2`; 64 MB de memória, 3 iterações, paralelismo 2) em formato PHC. Mínimo de 12 caracteres; recusar senhas de uma lista local das 100 mil mais comuns. Refazer o hash no login quando os parâmetros mudarem.
- **Sessão:** token opaco aleatório de 32 bytes, guardado apenas como SHA-256 em `user_sessions`. Vai em cookie `HttpOnly`, `Secure`, `SameSite=Strict`; sem JWT. A API também aceita `Authorization: Bearer <token>`, reservado ao Pulse na fase 2.
- **Dois realms:** sessões `platform` só valem em `/v1/hq`; sessões `tenant` só nas rotas de cliente. O QG e o dash têm endpoints de login separados.
- **Validade:** realm `platform` expira após 30 min ocioso ou 12 h no total; realm `tenant`, após 12 h ocioso ou 7 dias no total. Cada requisição renova o prazo ocioso.
- **MFA:** obrigatório para papéis `platform_*` desde o primeiro login. Opcional para clientes, e o `network_admin` pode torná-lo obrigatório para a rede (`tenants.require_mfa`). Passkey/WebAuthn (`go-webauthn/webauthn`), com presença e verificação do usuário obrigatórias (PIN/biometria/chave de segurança), credential residente e origem/RP ID exatos por realm. Cadastro inicial não gera sessão até a prova ser validada. Estado dos desafios e registro público da credencial selados com chave do Key Vault; nenhuma chave privada/biometria chega ao servidor. Dez códigos de recuperação de uso único continuam disponíveis como exceção explícita, após senha e somente com passkey já cadastrada; não existe fallback TOTP.
- **Força bruta:** após 5 falhas seguidas, a conta bloqueia por tempo crescente (1, 5, 15 e 60 min); no máximo 20 tentativas de login por minuto por IP. A resposta nunca revela se o e-mail existe.
- **Convite e redefinição:** o `network_admin` (ou o QG) cadastra o usuário, que recebe por e-mail um link de uso único, válido por 72 h, para definir a senha. Link de redefinição de senha: uso único, 30 min.
- **Revogação:** trocar ou redefinir a senha, desativar o usuário ou alterar seus grants encerra todas as sessões dele.
- **CSRF:** além de `SameSite=Strict`, toda requisição que altera estado exige o cabeçalho `X-CRMF-Request: 1`, e o CORS com credenciais só aceita as origens dos dois front-ends.
- **E-mails:** Azure Communication Services Email, modelos em pt-BR em `internal/server/auth/templates`.
- **Primeiro acesso:** o primeiro `platform_admin` é criado por `crmfctl user create-admin`. Não existe cadastro público.
- **Auditoria:** login, falha, bloqueio, MFA, convite, redefinição e encerramento de sessão vão para `audit_log`.

| Rota | Função |
| --- | --- |
| `POST /v1/auth/login` e `POST /v1/hq/auth/login` | E-mail e senha; devolvem sessão ou pedido de MFA |
| `POST /v1/auth/passkey` e `POST /v1/hq/auth/passkey` | Prova WebAuthn (cadastro/assertion) ou código de recuperação de uso único; concluem o login |
| `POST /v1/auth/logout` e `POST /v1/hq/auth/logout` | Encerram a sessão atual |
| `POST /v1/auth/password/forgot` | Envia link de redefinição; sempre responde `202` |
| `POST /v1/auth/password/reset` | Define nova senha com o token do link |
| `POST /v1/auth/invite/accept` | Define a senha inicial com o token do convite |
| `GET` e `DELETE /v1/me/sessions` | Lista e encerra as próprias sessões |
| `PUT /v1/me/password` | Troca a senha, exigindo a atual |
| `POST` e `DELETE /v1/me/passkey` | Cadastra passkey (com senha atual e prova WebAuthn) ou remove, quando permitido; remoção e gerenciamento de múltiplas chaves ainda pendentes |

As rotas equivalentes de redefinição, convite e conta existem também sob `/v1/hq`.

### 9.2 Escopo e papéis

- Toda requisição autenticada chega com uma sessão válida (seção 9.1). A API carrega usuário e grants do banco a cada requisição, para que desativações e mudanças de papel valham na hora.
- Usuário sem registro em `users` ou com `status` diferente de `active`: `403`.
- O middleware monta um `Scope` a partir de `user_grants` e o coloca no contexto: tipo (plataforma ou tenant), `tenant_id`, lojas permitidas e `seller_code`.
- Um usuário de cliente pertence a um único tenant. Papéis `platform_*` nunca acessam rotas de cliente, e papéis de cliente nunca acessam `/v1/hq`.
- Todo filtro de loja recebido é interseção com as lojas do `Scope`. Pedir uma loja fora do escopo devolve `404`, não `403`.

| Papel | Vê | Pode alterar |
| --- | --- | --- |
| `platform_admin` | Todo o QG, `platform.*`, dados operacionais | Tenants, planos, assinaturas, lojas, dispositivos, releases, conectores |
| `platform_support` | Todo o QG em leitura | Comandos de dispositivo, reprocessamento |
| `network_admin` | Todas as lojas da rede | Usuários da rede, metas |
| `store_manager` | Lojas do seu grant | Metas das suas lojas |
| `employee` | Os próprios indicadores e o total do dia da loja | Nada |

### 9.3 Planos na API

- Middleware `RequireModule("realtime")` etc. devolve `403` com `type` `module_not_in_plan` quando o módulo não está em `EffectiveLimits`.
- Datas pedidas antes de `hoje − history_months` são cortadas, e a resposta informa o corte em `meta.history_clamped_from`.
- Criar usuário ou loja além de `max_users` ou `max_stores` devolve `409` com `type` `plan_limit`.
- Tenant suspenso: todas as rotas de cliente devolvem `402`.

### 9.4 Rotas de cliente

Toda rota de indicador aceita `from`, `to` (datas) e `stores` (lista de ids, opcional) e devolve `meta.data_as_of` por loja (horário do último lote processado).

| Rota | Retorno |
| --- | --- |
| `GET /v1/me` | Usuário, papel, tenant, lojas permitidas, módulos do plano |
| `GET /v1/stores` | Lojas do escopo com status de dados (`ok`, `delayed`, `offline`) |
| `GET /v1/indicators/summary` | Indicadores da seção 5.4 no período e variação contra o período anterior de mesmo tamanho |
| `GET /v1/indicators/timeseries` | Série diária (ou horária com `granularity=hour`, só até 7 dias) de uma métrica |
| `GET /v1/indicators/mix` | Participação por `dimension` = `category`, `manufacturer` ou `generic` |
| `GET /v1/indicators/abc` | Curva ABC de produtos, paginada |
| `GET /v1/indicators/sellers` | Ranking de vendedores; `employee` recebe só a própria linha e a sua posição |
| `GET /v1/indicators/stores` | Comparativo entre lojas (só com mais de uma loja no escopo) |
| `GET /v1/today` | `store_today` das lojas do escopo; exige módulo `realtime` |
| `GET/PUT /v1/targets` | Metas mensais por loja |
| `GET/POST/PATCH /v1/users` | Usuários da rede; só `network_admin` |
| `GET /v1/exports/{report}` | CSV de um relatório; exige módulo `export` |

Status de dados da loja: `ok` se houve lote processado em até 2× o intervalo do plano; `delayed` entre 2× e 6×; `offline` se o último heartbeat tem mais de 10 minutos.

### 9.5 Rotas do QG (`/v1/hq`)

| Recurso | Operações |
| --- | --- |
| `tenants` | Listar, criar (dispara `provision_tenant`), editar, suspender, reativar, cancelar |
| `plans` | CRUD; um plano em uso não pode ser apagado, só desativado |
| `subscriptions` | Trocar plano, editar `overrides`, ver eventos de cobrança |
| `stores` | CRUD por tenant; gerar código de pareamento (mostrado uma única vez) |
| `devices` | Listar com saúde, revogar, enviar comando, definir versão-alvo |
| `batches` | Listar e filtrar por tenant, loja, status e período; ver erro; reprocessar |
| `releases` | Listar, publicar, retirar; aplicar versão-alvo a um dispositivo, uma loja, um tenant ou todos |
| `connectors` | Listar versões; ativar uma versão assinada para um ERP |
| `overview` | Totais por tenant e loja a partir de `platform.tenant_store_day`; contagem de dispositivos por saúde |
| `audit` | Consultar o log de auditoria |
| `users` | Usuários internos e primeiro `network_admin` de cada rede |

### 9.6 Cobrança

- `POST /v1/billing/webhook`: valida a assinatura do gateway, grava em `billing_events` (idempotente pelo id do evento) e atualiza `subscriptions.status`.
- `past_due` por mais de 10 dias vira `suspended`, com `grace_until` = suspensão + 30 dias. Pagamento confirmado volta a `active`.
- A integração fica atrás da interface `billing.Gateway`, para trocar de provedor sem mexer no resto. Na fase 1, a criação de cliente e assinatura no gateway pode ser manual, com o id copiado no QG.

### 9.7 Requisitos não funcionais

- p95 abaixo de 500 ms para rotas de indicador em até 90 dias e 50 lojas.
- Nenhum cache compartilhado entre tenants na fase 1; respostas de indicador usam `ETag` baseado no `data_as_of`.
- CORS restrito aos domínios dos dois front-ends.

## 10. Front-ends: QG e dash web

Dois SPAs React no workspace `web/`, publicados em domínios separados (`hq.<domínio>` e `app.<domínio>`) e cada um com sua própria tela de login (realms da seção 9.1). Ambos usam o design system CRMF em `packages/ui`.

### 10.1 Pacotes compartilhados

- `packages/ui`: tokens (cores, tipografia, espaçamento) e componentes base (botão, campo, tabela com ordenação e paginação, cartão de indicador, filtro de período, seletor de lojas, badge de status, estado vazio, estado de erro). O design system do CRMF já existe e deve ser importado como fonte desses tokens; o agente de código pede o arquivo antes do marco M5.
- `packages/api-client`: clientes gerados dos dois contratos com `openapi-fetch`, mais hooks TanStack Query por recurso.
- `packages/charts`: componentes `LineChart`, `BarChart`, `StackedBar`, `Donut` (só para mix com até 6 fatias), `Heatmap` (dia da semana × hora) e `Pareto` (curva ABC), todos sobre ECharts, com tema derivado dos tokens e formatação pt-BR (R$, milhar com ponto, decimal com vírgula).
- `packages/auth`: telas de login, MFA, aceite de convite e redefinição de senha; tratamento de sessão expirada; `useScope()` com papel, lojas e módulos vindos de `GET /v1/me`.

### 10.2 Dash web (`apps/dash`)

Filtro global no topo: período (hoje, ontem, 7 dias, mês atual, mês anterior, personalizado) e lojas (visível só com mais de uma loja no escopo). O filtro vai para a URL, para links compartilháveis.

| Tela | Conteúdo | Papéis |
| --- | --- | --- |
| Visão geral | Cartões de faturamento, margem %, CMV, cupons, ticket médio, itens por cupom com variação; série diária; atingimento de meta | network\_admin, store\_manager |
| Hoje | `store_today` por loja, venda por hora, "atualizado há X min", status da loja; atualização automática a cada 60 s | Com módulo `realtime` |
| Mix | Participação e margem por categoria, fabricante e genérico/referência | network\_admin, store\_manager |
| Produtos | Curva ABC, busca por descrição ou EAN, detalhe do produto com série e margem | network\_admin, store\_manager |
| Lojas | Comparativo entre lojas (tabela e barras), mapa de calor dia × hora | network\_admin |
| Vendedores | Ranking por faturamento e margem | network\_admin, store\_manager |
| Meu desempenho | Próprios indicadores, posição no ranking, total do dia da loja | employee |
| Metas | Edição de metas mensais por loja | network\_admin, store\_manager |
| Usuários | Convidar, editar papel e lojas, desativar | network\_admin |

Regras: módulo fora do plano aparece no menu como bloqueado, com texto explicando o plano necessário; loja `delayed` ou `offline` mostra aviso junto aos números; valores do dia corrente têm a etiqueta "parcial".

### 10.3 QG (`apps/hq`)

| Tela | Conteúdo |
| --- | --- |
| Painel | Redes ativas, lojas, dispositivos por saúde (ok, atrasado, offline, versão desatualizada), lotes falhos nas últimas 24 h, faturamento agregado por rede |
| Redes | Lista e detalhe da rede: dados cadastrais, assinatura e plano, lojas, usuários, eventos de cobrança |
| Lojas | Cadastro, geração de código de pareamento com instruções de instalação copiáveis |
| Dispositivos | Lista com última comunicação, versões, erros por stream, spool; ações: comando, revogar, versão-alvo |
| Monitor de envios | Lotes por loja numa linha do tempo, filtros por status, detalhe com erro, botão de reprocessar |
| Planos | CRUD de planos com limites e módulos |
| Releases | Versões publicadas por componente e arquitetura; distribuição por versão; aplicar versão-alvo em ondas |
| Conectores | Versões do conector Linx Big e qual está ativa |
| Auditoria | Busca no log por ator, rede e ação |

Ações destrutivas (revogar dispositivo, suspender rede, retirar release) pedem confirmação digitando o nome do alvo.

### 10.4 Requisitos comuns

- Responsivo a partir de 360 px de largura, com prioridade para desktop no QG.
- Acessibilidade WCAG 2.1 AA: contraste, navegação por teclado, gráficos com tabela alternativa.
- Tema claro e escuro a partir dos tokens.
- Erros da API (`problem+json`) mostrados com a mensagem traduzida pelo `type`.

## 11. Segurança e isolamento entre tenants

O requisito número um é nenhum vazamento entre redes. O isolamento é aplicado em cinco camadas, e cada uma deve ser testada de forma independente.

| Camada | Mecanismo | Teste obrigatório |
| --- | --- | --- |
| Identidade | Tenant vem do token do dispositivo ou dos grants do usuário, nunca da requisição | Requisição com `tenant_id` ou `store_id` de outra rede em qualquer campo é ignorada ou devolve `404` |
| Banco | Schema e role de login por tenant; `r_a` não tem privilégio em `t_b` | Teste de integração: conectado como `r_a`, `SELECT` em `t_b.fact_sale_item` falha com erro de permissão |
| Código | `tenancy.Pool` só aceita o tenant do contexto autenticado; lint proíbe `fmt.Sprintf` com SQL | Teste de propriedade: para N tenants e usuários aleatórios, nenhuma resposta contém `store_id` fora do escopo |
| Armazenamento | Caminho do blob definido pelo servidor com o tenant do token; SAS de um único blob | Agente do tenant A não consegue escrever nem ler fora do próprio prefixo |
| Visão global | QG lê só `platform.*` com `crmf_platform_reader` | Usuário `platform_admin` não tem rota que leia schema de tenant |

**Outras regras**

- Dados do cliente final nunca são extraídos (lista de colunas proibidas no CI, seção 6.3).
- Hash de senha, sessões, credenciais públicas e desafios WebAuthn selados ficam no schema auth, acessível só pelo role crmf\_auth. Segredos só no Key Vault; o backend usa identidade gerenciada para ler Key Vault, Blob Storage e Postgres (autenticação Entra para os roles de serviço, senha só para os roles de tenant).
- Postgres e Storage sem acesso público: integração por rede virtual e endpoints privados; o Blob Storage aceita escrita externa apenas via SAS.
- TLS 1.2 ou superior em todos os endpoints; HSTS nos front-ends.
- Chave Ed25519 de releases e conectores: gerada offline, privada só em segredo do ambiente de release do GitHub com aprovação manual; pública embutida no updater e no agente.
- Logs nunca registram tokens, senhas, corpo de lotes ou valores de venda linha a linha.
- Dependências verificadas no CI (`govulncheck`, `pnpm audit`) e imagens de container escaneadas.
- LGPD: registro das operações de tratamento em `docs/lgpd.md`; dados de usuários (nome e e-mail) apagados 30 dias após cancelamento do tenant, e o schema do tenant apagado após 90 dias, salvo pedido contrário.

## 12. Infraestrutura, CI/CD e observabilidade

Toda a infraestrutura Azure é criada por Terraform em `infra/`, com dois ambientes idênticos em estrutura (`hml` e `prd`) e região Brazil South.

### 12.1 Recursos por ambiente

| Módulo Terraform | Recursos |
| --- | --- |
| `network` | VNet, subnets para Container Apps e endpoints privados, DNS privado |
| `postgres` | PostgreSQL Flexible Server 16, bancos `crmf_control` e `crmf_analytics`, backup de 14 dias (35 em `prd`), alta disponibilidade só em `prd` |
| `storage` | Storage Account com containers `raw`, `quarantine`, `diagnostics`, `releases`; política de ciclo de vida da seção 8.4; versionamento e soft delete ativos |
| `keyvault` | Key Vault com RBAC; segredos de roles de tenant e do gateway |
| `container_apps` | Ambiente, app `api` (mínimo 1 réplica, escala por HTTP), app `worker` (mínimo 1, escala por profundidade da fila), job de migração; identidade gerenciada |
| `registry` | Azure Container Registry |
| `static_web` | Static Web Apps para `hq` e `dash` |
| `observability` | Log Analytics, Application Insights, alertas |
| `dns` | Registros de `api`, `ingest`, `hq`, `app` |

- Estado remoto em Storage Account dedicada (`tfstate`), um arquivo por ambiente, com bloqueio por lease.
- O Azure Communication Services Email entra num módulo \`email\`, com domínio de envio verificado. O gateway de cobrança fica fora do Terraform na fase 1; seus ids e segredos entram como variáveis e segredos do Key Vault.

### 12.2 Pipelines (GitHub Actions)

| Workflow | Gatilho | Passos |
| --- | --- | --- |
| `ci.yml` | todo PR | `make gen` sem diff, lint, testes Go (com Postgres e MariaDB em containers), testes web, build das imagens, `govulncheck`, `pnpm audit`, checagem de colunas proibidas |
| `agent-ci.yml` | PR que toca `cmd/agent`, `cmd/updater`, `internal/agent`, `internal/updater`, `installer` | Testes em `windows-latest`, build amd64 e 386, MSI, teste de instalação e OTA |
| `infra.yml` | PR em `infra/` | `terraform fmt`, `validate`, `plan` comentado no PR; `apply` em `hml` no merge, em `prd` com aprovação |
| `deploy.yml` | merge em `main` | Publica imagem, roda migrações de controle e plataforma, atualiza `api` e `worker` em `hml`, dispara `migrate_tenants`; promoção para `prd` com aprovação manual |
| `web-deploy.yml` | merge em `main` | Build e publicação de `hq` e `dash` |
| `agent-release.yml` | tag `agent-v*` | Build, Authenticode, assinatura Ed25519, upload em `releases/`, registro como `draft` no QG via API |
| `connector-release.yml` | tag `connector-linxbig-v*` | Valida o YAML, assina, registra como `draft` |

Autenticação no Azure por OIDC federado; nenhum segredo de nuvem fica no GitHub. O ambiente `release` do GitHub guarda a chave Ed25519 e exige aprovação manual.

### 12.3 Observabilidade

- Backend instrumentado com OpenTelemetry (traces, métricas) e `slog` em JSON; todo log e span carrega `tenant_id`, `store_id` e `device_id` quando existirem.
- Métricas obrigatórias: lotes recebidos e processados por status, tempo de processamento por stream, idade do último lote por loja, dispositivos por saúde e versão, profundidade da fila, latência e erros por rota.
- Alertas iniciais: lote em `failed` ou `quarantined`; fila com job mais antigo acima de 5 minutos; erro 5xx acima de 1% em 5 minutos; loja de cliente ativo sem lote há mais de 6× o intervalo do plano; falha de OTA em mais de 1 dispositivo da mesma versão.
- `GET /healthz` (vivo) e `GET /readyz` (banco e Storage acessíveis) no backend.

## 13. Testes, aceite e marcos

O piloto está pronto quando as 3 lojas enviam dados por 7 dias seguidos e os totais diários do dash batem com o relatório de vendas do Linx Big após a reconciliação noturna.

### 13.1 Estratégia de testes

- **Unitários:** mapeadores, cálculo de indicadores, `EffectiveLimits`, verificação de assinatura, agendador do agente.
- **Integração:** `testcontainers-go` com Postgres 16, MariaDB 10.6 e Azurite; cada teste cria tenants próprios.
- **Contrato:** handlers gerados a partir do OpenAPI; teste de CI garante que o código gerado está em dia.
- **Ponta a ponta:** o núcleo do agente roda também em modo console (`agent run --console`), sem a camada de serviço Windows, o que permite executá-lo em Linux no CI. Cenário: MariaDB com base Linx Big de teste e gerador de vendas, agente, backend, e asserções sobre os agregados.
- **Windows:** instalação do MSI, pareamento, reinicialização do serviço, OTA e rollback em `windows-latest`.
- **Isolamento:** os testes da seção 11, todos obrigatórios no CI.
- **Carga:** simulador de dispositivos (`crmfctl simulate --devices 300 --interval 180s`) por 1 hora; meta: p95 de processamento abaixo de 60 s e nenhum lote perdido.
- **Front-end:** Vitest para componentes e Playwright para os fluxos principais de cada papel.

### 13.2 Critérios de aceite do piloto

- [ ] No plano de 3 minutos, uma venda feita no PDV aparece na tela Hoje em até 5 minutos.
- [ ] Totais diários por loja (faturamento líquido, cupons) iguais ao relatório do Linx Big por 7 dias seguidos.
- [ ] Loja sem internet por 4 horas: nenhum dado perdido depois da volta.
- [ ] Servidor da loja desligado durante a noite: trilha fria roda ao religar.
- [ ] Release propositalmente quebrada volta sozinha à versão anterior em até 10 minutos.
- [ ] Dispositivo revogado para de enviar em até 15 minutos.
- [ ] Todos os testes de isolamento passam; usuário de uma rede não vê nenhum dado de outra.
- [ ] Troca de plano no QG muda o intervalo de coleta do agente em até 2 minutos.
- [ ] QG mostra cada loja com status correto (ok, atrasado, offline) e cada lote com seu estado.

### 13.3 Marcos

Cada marco termina com PR aprovado, CI verde e demonstração do critério listado.

| Marco | Entregas | Pronto quando |
| --- | --- | --- |
| M0 Fundação | Repositório, `Makefile`, `docker compose`, CI, esqueletos OpenAPI, goose, Terraform base de `hml` | `make dev` sobe tudo localmente e o CI passa |
| M1 Controle e tenancy | Schema de controle, `provision_tenant`, migrações de tenant, autenticação própria com MFA, `/v1/me`, QG mínimo (redes, planos, lojas, código de pareamento) | Criar uma rede no QG gera schema e role; testes de isolamento de banco passam |
| M2 Conector Linx Big | Inspeção da base de teste, YAML do conector, mapeador, colunas proibidas, ADR do CMV | Mapeador converte amostras reais com 100% de cobertura de colunas usadas |
| M3 Agente e ingestão | Pareamento, token, heartbeat, config, extração quente e fria, spool, envio, API de ingestão, MSI | Agente em Windows envia lotes que chegam ao Blob Storage e ficam `uploaded` |
| M4 Worker | `process_batch`, agregados, `store_today`, reconciliação, `platform` | Cenário ponta a ponta confere agregados com o gerador de vendas |
| M5 Dash web | Pacotes `ui`, `charts`, `auth`; telas da seção 10.2 | Fluxos Playwright de cada papel passam |
| M6 QG completo | Dispositivos, monitor de envios, planos, auditoria | Operação completa de uma rede sem acessar o banco |
| M7 OTA | Updater, pipeline de release, tela de releases, rollback | Teste de OTA com rollback forçado passa no Windows |
| M8 Piloto | Infra `prd`, alertas, runbooks, teste de carga, instalação nas 3 lojas | Critérios da seção 13.2 atendidos |

## 14. Pontos em aberto e premissas

O agente de código pode começar M0 e M1 sem nenhum destes pontos; os demais marcos indicam qual decisão precisam.

| Ponto | Premissa adotada até decidir | Bloqueia |
| --- | --- | --- |
| Quem desenvolve e mantém (time ou agentes de código) | API de aplicação em Go, como o resto do backend | Nada; trocar para TypeScript exige ADR antes de M1 |
| Domínio de envio dos e-mails de convite e senha | Azure Communication Services com domínio próprio; Mailpit no ambiente local | M1 em `hml` |
| Gateway de cobrança | Interface `billing.Gateway` com implementação falsa; cadastro manual no QG | Nada na fase 1 |
| Tabelas do Linx Big e coluna de cursor confiável nas vendas | A confirmar na base de teste | M2 |
| PDV grava direto na base do servidor da loja ou sincroniza em lotes | A medir no piloto; define a latência real do plano de 3 minutos | Aceite do piloto |
| Origem do custo do item (CMV) no Linx Big | Custo gravado na venda; senão, custo médio na data | M2 |
| Topologia das 3 lojas (base por loja ou consolidada na matriz) | Uma base por loja, um agente por loja | M8 |
| Windows Server 2012 em alguma loja | Piso Windows 10 e Server 2016 | M8 |
| O que o funcionário vê dos colegas | Só a própria linha e a posição no ranking | M5 |
| Acesso de suporte ao dash de um cliente | Fora da fase 1; o time interno vê só `platform` | Nada |
| Domínio da plataforma | Variável `domain` no Terraform | M0 em `hml` |
| Arquivo do design system CRMF | Pedido ao Antonio antes de M5 | M5 |
| Certificado de assinatura de código (OV ou EV) | Builds de `hml` sem Authenticode | M7 em `prd` |
| Retenção do bruto (400 dias) frente a `history_months` do plano | 400 dias para todos | Nada |

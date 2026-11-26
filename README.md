# CRMF

Fundação M0 do dashboard multitenant para redes de farmácias, com M1 iniciado
pela separação de identidade/controle e prévia visual mockada de **Meu
desempenho** e **Minhas metas**, solicitada antes do M1.
A especificação de fase 1 na raiz continua sendo a referência de escopo.

## Requisitos

- Go 1.27.4 (ou toolchain compatível com go.mod), Node 22.12+ ou 24, pnpm 10.29.3.
- Python 3.12+, GNU Make, Docker com Compose v2+, Terraform 1.14+.
- Windows: execute pelo Git Bash com as ferramentas no PATH. O Go portátil
  em `.tools/go/bin`, quando presente, é detectado pelo executor de tarefas.
- Opcional: `python scripts/bootstrap_tools.py` baixa sqlc e golangci-lint
  oficiais para `.tools/bin`, verificando SHA-256; sem eles, os alvos usam `go run`.

```sh
pnpm --dir web install --frozen-lockfile
make dev
```

O comando constrói a API e as duas SPAs, aplica as migrações de controle e
plataforma e sobe Postgres 16, MariaDB 10.6 sintético, Azurite e Keycloak.
Aguarda os endpoints responderem antes de indicar sucesso.

| Serviço | Endereço |
| --- | --- |
| API / liveness / readiness | http://localhost:8080/healthz e /readyz |
| QG | http://localhost:5173 |
| Dash | http://localhost:5174 |
| Keycloak legado, não usado pela autenticação | http://localhost:18080/realms/crmf |
| Postgres | localhost:55432 |
| MariaDB sintético | localhost:53306 |
| Azurite Blob | localhost:51000 |

Credenciais **exclusivas de desenvolvimento** estão em `.env.example` e nos
scripts de inicialização locais. Keycloak: `admin` / `crmf_local_admin_only`.
Não há usuários finais pré-cadastrados. O QG e `/login` do Dash têm telas
M1 de login/MFA; habilite a API com `python scripts/tasks.py auth-dev`.
Veja [fluxos e limites da autenticação web](docs/implementation/authentication-web.md)
e [novo layout de autenticação](docs/implementation/authentication-layout.md): login,
passkey, recuperação e Minha conta. A [segurança da própria conta](docs/implementation/account-security.md)
já permite trocar a senha com prova da senha atual e consultar/encerrar suas
sessões, preservando passkeys. Recuperação por e-mail e convites continuam previstos.
A [base de e-mail local](docs/implementation/local-auth-mail.md), com Mailpit e
modelos pt-BR, já permite testar a captura sem emitir tokens ou alterar contas:
`python scripts/tasks.py mail-dev` (http://localhost:18025). O [núcleo interno de
recuperação](docs/implementation/password-reset-kernel.md) já valida e consome
provas de uso único, sem expor emissor/rota pública; pedido e telas ainda pendem. No QG de
**desenvolvimento**, `/__auth-design` permite conferir as 94 variações visuais.
O [novo layout do QG](docs/implementation/hq-layout.md) preserva Planos/Redes
reais e monta as demais telas operacionais como **Previsto**, sem dados fictícios
na sessão real. As [telas de Lojas](docs/implementation/hq-stores.md) têm lista,
formulário e detalhe integrados ao cadastro real, com edição/inativação,
revisão, auditoria e limite de lojas transacional. A [emissão de códigos de
pareamento](docs/implementation/store-pairing-codes.md) por loja já é real, com
exibição única, validade de 72 horas, revogação e auditoria. Consumo pelo agente,
instalador e telemetria continuam previstos, sem simular agente instalado. O [cadastro comercial de Redes](docs/implementation/network-profiles.md)
persiste razão social, cidade/UF, contatos, fuso e referência de cobrança, com edição
versionada e sugestões automáticas ao informar o CNPJ (sem obrigar a consulta).
`/__qg-design`, somente em desenvolvimento, reúne as 125 pranchetas.

## Homologação web na VPS

O [runbook da entrada web](docs/runbooks/vps-web-homologation.md) descreve a imagem
production de QG/login com Caddy, ensaio em loopback e HTTPS após validação do DNS.
A API fica explicitamente em **503** até a implantação segura de identidade e
custódia; isto não publica o dashboard sintético como negócio nem conclui M1.
A arquitetura de produção Azure permanece a da especificação.

## Prévia do dashboard (sem backend)

```sh
pnpm --dir web --filter @crmf/dash dev
```

Abra http://localhost:5174/meu-desempenho ou http://localhost:5174/minhas-metas.
Não é necessário iniciar Docker, API, Keycloak ou ERP. Se o Dash do Compose
já estiver ocupando 5174, pare somente esse serviço ou use `dev --port 5176`.
O seletor **Cenário** permite avaliar dados fictícios, ausência de vendas/base,
carregamento e erro. Veja [escopo, referências e testes da prévia](docs/design/dashboard-demo.md).

## Comandos

```sh
make gen          # sqlc, oapi-codegen, clientes TypeScript
make test         # Go, Python e Vitest
make integration  # bancos locais, migrações idempotentes e leitor ERP sem escrita
make lint         # Go, ESLint, Prettier, TypeScript, privacidade e Terraform fmt
make build        # binários Go e SPAs
make agent        # agent/updater Windows amd64 e 386 (ainda shells)
make security     # govulncheck e pnpm audit
make stop         # para apenas o projeto crmf-dev, sem apagar volumes
```

Todos os alvos têm equivalente `python scripts/tasks.py <alvo>` para Windows
sem Make. Após alterar fontes, `make dev` reconstrói as imagens; para front-end
com HMR no host, use `pnpm --dir web dev`. A prévia mockada do Dash não depende
dos serviços Docker; estes só são necessários para testar a fundação da API.
Isso evita misturar dependências nativas Windows e Linux nos containers.

## Limites desta entrega

- Implementado: monorepo, processos buildáveis, contratos e clientes gerados,
  health/readiness reais, migrações base independentes, ambiente Docker local,
  shell autenticado do QG com Planos e Redes, prévia mockada do Dash, tokens/componentes visuais iniciais,
  verificações locais e workflows de CI/Terraform.
- M1 parcial: schemas `auth`/`core`, cadastros-base, roles restritos, auditoria
  append-only para os roles de aplicação; motor interno de login, MFA por passkeys/WebAuthn (sem TOTP),
  recuperação de uso único, bloqueios e limite de tentativas por IP no Postgres,
  além de sessões opacas, grants e revogação. Rotas HTTP de autenticação e
  identidade são opt-in com `python scripts/tasks.py auth-dev`; produção exige
  segredo versionado do Key Vault via identidade gerenciada (ainda sem validação
  em Azure). O primeiro administrador é criado manualmente por
  `crmfctl user create-admin`, com senha no terminal e MFA no primeiro login;
  o QG autenticado já tem [gestão real de planos](docs/implementation/hq-plans.md),
  com limites, módulos, revisões e auditoria; convites e
  envio de recuperação ainda pendem. O [consumo de link e formulário de nova senha](docs/implementation/password-reset-web.md)
  já redefine a senha sem remover fatores ou criar sessão; o emissor permanece privado. O [núcleo de provisionamento](docs/implementation/tenant-provisioning.md)
  já cria schema/role por rede via CLI de operador, aplica migrações e oferece
  pools por contexto autenticado. O [QG Redes](docs/implementation/hq-networks.md)
  já cadastra redes e acompanha fila, preparação, prontidão e nova tentativa,
  com processo privilegiado separado da API.
  O motor interno
  de [limites efetivos](docs/implementation/effective-limits.md) já resolve plano
  e overrides pelo contexto autenticado, ainda sem integração nas futuras rotas
  de negócio. Veja [estado e próximos incrementos](docs/implementation/m1-control.md).
- Ainda não implementado: fluxos complementares de autenticação, consumo de códigos pelo agente/instalador
  e aceite completo de provisionamento/isolamento por tenant (M1),
  conector real (M2), coleta/ingestão/MSI (M3), jobs de ingestão River e agregados (M4),
  interfaces finais, design system completo e permissões integradas (M5/M6),
  OTA (M7), produção e piloto (M8). A prévia visual não conclui M1 nem M5.
- `worker` M0 verifica dependências e aguarda encerramento; não consome lotes.
- A API sem configuração de autenticação não expõe cadastros; com opt-in, os
  serviços M1 acima são reais. Não há rotas de indicadores reais no dashboard.
- Terraform M0 prepara bootstrap do estado e resource group de hml; nenhum
  recurso de nuvem é criado pelos comandos locais.
- Verificações locais não substituem o aceite remoto: acompanhe as execuções
  em [GitHub Actions](https://github.com/tomfonseca/crmf2026/actions).

## Base Linx Big restaurada

A instância em `E:\\crmf\\db` é independente: nenhum comando deste projeto a
monta, reinicia ou modifica. Não copie seus registros para código, fixtures,
logs ou CI. A inspeção para o conector será somente leitura no M2. Relações
inferidas no schema extraído não são chaves estrangeiras comprovadas.
Dumps, relatórios de conferência, metadata extraída e referências locais de
HTML ficam fora deste repositório público. Consulte os limites de acesso em
[docs/data/README.md](docs/data/README.md).

## Documentação de referência

- [Fechamento de autenticação/autorização](docs/implementation/authentication-completion.md): critérios e lacunas de login, passkeys, recuperação e planos.
- [M1 — controle e identidade](docs/implementation/m1-control.md): incrementos entregues, verificações e próximos passos.
- [Spec de implementação — fase 1](<CRMF — Spec de implementação (fase 1).md>): arquitetura, escopo e marcos.
- [Evidências ERP e limites de publicação](docs/data/README.md): artefatos privados necessários para trabalhos de mapeamento e análise.
- [Prévia mockada do dashboard](docs/design/dashboard-demo.md): referências HTML, limites e testes de navegador.
- [Desenvolvimento local](docs/runbooks/local-development.md), [Terraform](infra/README.md) e [decisões de arquitetura](docs/adr/).

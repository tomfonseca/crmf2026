# Dashboard: prévia visual antes do M1

## Escopo e origem

Por solicitação do usuário, antecipamos somente a camada visual de **Meu
desempenho**, **Minhas metas** e **Minhas lojas**. Não é a conclusão de M1/M5,
uma implementação de autenticação ou uma integração com o Linx Big.

Referências fornecidas e mantidas apenas no ambiente local autorizado:

| ZIP | HTML | SHA-256 do ZIP |
| --- | --- | --- |
| Minhas metas-html.zip | Metas.dc.html | `6b6257be0c4d0e3830d659a7e0e969d30fefa86d1db64ff7c116bd753e23acda` |
| Meu desempenho-html.zip | Main.dc.html | `55abdd967b7042691752182c4913b54afc495edd1b03531f9a7317cedcf1e9ff` |

Os ZIPs permanecem intactos. Os tokens, dimensões e estrutura foram
reimplementados em React/CSS, como orientam seus READMEs; o runtime do
exportador e seus bundles React não foram incorporados ao produto. Extrações
locais para inspeção ficam em `.tools/design-references/`, fora do Git.

Os HTMLs apresentam estados sem dados/erro. Além desses estados, a prévia
oferece conteúdo sintético para avaliar a hierarquia visual. Mantém o tema
escuro inicial, claro alternativo, sidebar 256/72 px, controles de 36 px,
tipografia system-ui, acento teal, cartões, filtros e tabela horizontal.

## Executar e navegar

```sh
pnpm --dir web install --frozen-lockfile
pnpm --dir web --filter @crmf/dash dev
```

- http://localhost:5174/meu-desempenho
- http://localhost:5174/minhas-metas
- A raiz redireciona para Meu desempenho.
- Em conflito com o container Dash, use `dev --port 5176`.
- Docker, API, Keycloak, bancos e restauração ERP não são necessários.

Filtros de mês/ano, período personalizado, loja, cenário e indicador do gráfico
ficam na URL; links diretos e voltar/avançar preservam o estado. As datas de
Minhas metas só são aplicadas em **Buscar**. A busca na tabela, ordenação e
paginação são locais; o total filtrado considera todos os resultados, não
apenas a página visível. O CSV exporta filial, grupo, meta, líquido e cupons
de todos os resultados filtrados, sem paginação, com BOM UTF-8, separador
ponto e vírgula e proteção contra fórmulas de planilha.

A busca do cabeçalho navega entre as duas páginas. Menu, lojas, documentação,
perfil e notificações são interações locais. **Sair** explica que ainda não há
autenticação: não finge revogar uma sessão inexistente. Só o tema é persistido
no localStorage; não há credenciais nem registros de pessoas.

## Dados e estados

`web/apps/dash/src/demo/data.ts` é a única fonte de agregados: geração
determinística em centavos, duas lojas e seis grupos. Os nomes de exibição
seguem as referências visuais, sem consultar cadastros reais.
A data fictícia de referência é **25/11/2026**. “Mês atual” significa novembro
de 2026, independentemente do relógio da máquina. O intervalo disponível é
2025–2026; datas futuras não recebem vendas.

O seletor **Cenário** permite:

- **Com dados**: indicadores e metas exemplificativos.
- **Sem vendas**: valores de venda zero; sem meta/cobertura; gráficos vazios.
- **Sem base / sem meta**: vendas disponíveis, mas custo, fidelidade, metas e
  comparação histórica sem cobertura.
- **Erro**: aviso explícito; nenhum cartão com zero apresentado como resposta.
  Tentar novamente recupera o cenário preenchido, com atraso local simulado.
- **Carregando**: estado visual persistente, até trocar o cenário.

Divisões sem base retornam “Sem base”; ausência de meta é “Sem meta”.
No exemplo, projeção = vendido / dias corridos × dias do período; necessidade
diária usa apenas dias restantes. Períodos encerrados não dividem por zero.
Metas de intervalos parciais/cruzando meses são proporcionais aos dias
corridos, exclusivamente para a simulação.

## Limites obrigatórios para a integração posterior

Esta solicitação autoriza dados fictícios na **interface**, não preencher
as pendências do [mapeamento privado](../data/README.md) com evidências
inventadas. Não houve consultas, extração, escrita ou acesso à restauração ERP.

- “Clientes atendidos” representa cupons sintéticos, não pessoas identificadas.
- CMV/fidelidade e metas por vendedor/grupo não são regras ERP validadas.
- Comparativos mensais **Eu × Loja**, participação e a opção **Todas as lojas**
  são prévias de design. Não concedem permissões além da spec.
- Metas sintéticas por grupo não equivalem a `store_targets`.
- Nenhuma regra sobre devoluções, operação ERP ou custo histórico foi alterada.
- M1 deve implementar autenticação própria e isolamento; M2 deve validar os dados; M4 deve
  produzir agregados; M5 deve aplicar escopos autorizados e integrar os contratos.
- Esta build de demonstração não deve ser publicada como dashboard de produção.

## Organização e verificações

- `web/apps/dash/src/`: shell, rotas TanStack Router e duas páginas.
- `web/packages/ui/`: tokens derivados dos HTMLs e componentes iniciais.
- `web/packages/charts/`: wrappers ECharts SVG com carregamento separado.
  Gráficos usados pelas páginas possuem tabela alternativa; donut limitado a
  seis grupos. O chunk assíncrono ECharts ainda passa de 500 kB minificado:
  aviso de build conhecido, a otimizar antes da entrega final M5.
- Layout a partir de 360 px, menu móvel com Escape e contenção de foco,
  popovers com Escape/clique externo, diálogos nativos e foco visível.
  Esses testes não substituem auditoria WCAG completa.

```sh
pnpm --dir web test
pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web build
pnpm --dir web audit --audit-level high
pnpm --dir web exec playwright install chromium
pnpm --dir web test:e2e
```

No Git Bash/Windows, também é possível usar Chrome já instalado:
`PLAYWRIGHT_CHANNEL=chrome pnpm --dir web test:e2e`.
Em PowerShell: `$env:PLAYWRIGHT_CHANNEL="chrome"` antes do comando.
Por padrão, Playwright usa seu Chromium gerenciado.

Os testes de navegador iniciam Vite isolado em 5175, verificam gráficos SVG,
navegação, URL/histórico, filtros, CSV, cenários, temas, recuperação, ausência
de chamadas ao backend e layout móvel. Capturas e traces locais ficam em
`web/test-results/` (ignorado pelo Git). O workflow executa a suíte Chromium.

Validação local desta entrega: 11 testes Vitest no workspace (10 no Dash e
1 no QG), três fluxos Playwright com Chrome, typecheck/build/lint e auditoria
de dependências aprovados. Nenhum resultado de GitHub Actions é presumido.

### Nota sobre Windows e junctions

Durante a validação, junctions pnpm criadas com `D:\dev` e resolução Vite
com `D:\Dev` carregaram duas identidades de React, causando “Invalid hook
call” só no Vitest. A causa foi confirmada normalizando os destinos das
junctions React/ReactDOM para a grafia nativa do diretório; a mesma suíte
passou sem mockar hooks ou alterar o código da aplicação. Isso foi um reparo
local em `node_modules`, não uma configuração especial exigida no Linux.
Ao reinstalar dependências no Windows, mantenha a grafia canônica do caminho.

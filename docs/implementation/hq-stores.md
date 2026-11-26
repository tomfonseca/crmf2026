# QG — Lojas: telas e cadastro real (Q15–Q17)

Lista, cadastro, consulta individual e edição/inativação são integrados à API e ao
PostgreSQL. **M1 continua parcial:** pareamento, dispositivos, ingestão e
telemetria não estão implementados por este incremento. Não há exclusão física,
semeadura de lojas operacionais ou conexão ao ERP.

## Rotas e comportamento

- `/stores`: catálogo paginado por UUID, até 100 registros; busca e rede filtram
  somente a página carregada. Vazio significa resposta vazia confirmada. Falha
  não vira catálogo vazio/zero; há erro e atualização explícita.
- `/stores/new`: três cartões Identificação / Localização / Integração, mantendo
  tokens, temas e grade adaptável das referências privadas. Rede deve estar
  preparada e ativa/em avaliação; plano/assinatura são revalidados no servidor.
  Código ERP e nome são manuais; não herdam a geração de códigos de Planos.
- `/stores/:id`: identidade vem de GET conferido, nunca do texto da URL. Exibe
  configuração real; saúde, dispositivo, lotes e última atualização ficam
  indisponíveis — ausência de telemetria não significa sem vendas/offline/sem
  pareamento. Não se usa `created_at`/`updated_at` como horário de ingestão.
- `/stores/:id/edit`: rede imutável; revisão congelada ao abrir; conflitos retêm
  rascunho, sem sobrescrita/retry automáticos. Inativação preserva identidade e
  histórico; não há DELETE. Código não pode mudar se houver dispositivo histórico,
  inclusive revogado, evitando trocar silenciosamente a identidade de extração.
- Redes → aba Lojas consulta a API com filtro exato de rede, paginação explícita,
  nomes/códigos reais e links ao detalhe. O cliente rejeita registros de outra rede.
- `/stores/:id/pairing` e `/stores/:id/reinstall` permanecem **Previsto**. Salvar
  configuração não emite código, token, MSI ou comando nem afirma agente instalado.

Admin cria/edita; suporte apenas lê, inclusive em URLs diretas. Consultas usam
cookie opaco, no-store, abort/12s, tratamento de expiração e cache da montagem
autenticada (`gcTime: 0`), não armazenamento local. Cancelar/menu/conta/logout/
histórico usam descarte **nesta loja** e beforeunload. Flags de rascunho/salvamento
são limpas **antes** de navegar após sucesso; mutação incerta exige conferir a
lista antes de repetir manualmente.

Fuso é configuração explícita. Selecionar uma rede usa seu fuso padrão salvo,
quando há; o formulário mantém uma escolha visível/manual se não houver. Isso
não prova o fuso do ERP nem muda lojas existentes quando o padrão da rede muda.
A situação é persistida no controle e aproveita a resolução viva de acessos;
coleta/ingestão ainda precisam implementar suas próprias verificações.

## Contrato e quota

Migração forward-only **00012** adiciona revisão/trigger. **00013** remove seu
índice redundante: a constraint `(tenant_id,id)` já fornece o índice necessário.
00012 já havia sido aplicada localmente, portanto não foi reescrita;
identidade `id/tenant_id` é imutável também no banco. API normal usa apenas pool
`crmf_core`; nenhuma credencial migratória ou custódia de tenant é entregue a ela.

- `GET /v1/hq/stores?after=<uuid>&tenant_id=<uuid>`: filtros opcionais, somente
  plataforma; rejeita parâmetros desconhecidos/duplicados/malformados.
- `GET /v1/hq/stores/{id}`: configuração conferida; inexistente 404.
- `POST /v1/hq/stores`: `tenant_id`, `code`, `name`, `city`, `uf`, `timezone`,
  `erp=linx_big`, `status=active|inactive`; 201 com identidade/revisão do servidor.
- `PUT /v1/hq/stores/{id}`: mesmos campos cadastrais, **sem tenant_id**, mais
  `version`; 200 ou 409 em conflito. Origin/cabeçalho CRMF e escopo fresco são
  obrigatórios nas mutações. JSON estrito <=8KiB, sem ator injetado/nulls/extras.

A reserva de MaxStores não é um contador do navegador: transação trava a linha
da rede e compartilha locks de assinatura/plano, lê limites e overrides vivos,
conta **todas as lojas, inclusive inativas**, insere e audita atomicamente. Não
há isenção silenciosa para inativas, nem `0` interpretado como ilimitado. Só
`null` explicitamente representa quota ilimitada. Exceder retorna **409 plan_limit**;
política inválida/indisponível falha fechada, nunca libera a criação.

Ordem de locks: rede → assinatura/plano → loja. Readiness do provisioner é lida,
sem conceder UPDATE nessa tabela à API apenas para obter row lock. Pareamento e
futuros escritores de política devem respeitar a ordem; não introduzir lock de
loja antes de rede. Ver [ADR 0009](../adr/0009-store-quota-and-retained-identity.md).

## Galeria e evidência

`StoreScreens.tsx` é compartilhado com a galeria. Somente `StorePreview.tsx`
contém registros sintéticos, eliminados do JavaScript de produção; galeria não
fornece API, sessão, identidade ou fallback. As 125 pranchetas continuam sem
requisições e a cobertura visual não equivale a aceite humano pixel-perfect.

Teste real PostgreSQL/HTTPS cria redes por API e provisiona de fato schema/role/
migrações com custódia temporária isolada. Quatro criações concorrentes sob quota
1 produzem **uma 201 e três 409 plan_limit**. Também verifica overrides vivos,
inativas contando, código único por rede, mesmo código em redes diferentes,
revisão/conflito, rede imutável, código congelado após dispositivo histórico,
auditoria atômica, filtros, CSRF e suporte somente leitura. Fixtures são removidos;
operator/passkey/chave original/volume de credenciais/ERP não são alterados.

Testes de navegador usam contratos interceptados (não são aceite de autenticador
nativo/provedor externo/Azure), cobrem cadastro/edição/inativação, padrão de fuso,
cota recusada sem perder rascunho, navegação/abas, indisponibilidade sem zeros,
98 testes unitários e 22 fluxos de navegador no conjunto atual. Revalidar CI e
revisar os PRs antes de mesclar; M1 não está concluído.

# QG — telas de Lojas (Q15–Q17)

Esta entrega implementa a apresentação React de **lista, cadastro/edição e
detalhe**, com base nas capturas Q15–Q17, nos HTMLs privados e na especificação
de layout fornecida. **Não implementa CRUD de lojas, pareamento, ingestão ou
telemetria. M1 continua parcial.** Nenhum cadastro foi semeado para parecer com
as imagens; exemplos não são evidência ERP nem criam lojas operacionais.

## Rotas autenticadas

- `/stores`: cabeçalho e ação Cadastrar loja, busca/rede/dados, sete colunas e
  rodapé que distingue sem vendas de offline. Sem API, mostra **Consulta de lojas
  ainda não disponível**, não um catálogo vazio, contagens zero ou saúde presumida.
- `/stores/new`: cartões Identificação, Localização, Integração em grade adaptável
  com mínimo de 420px; rede, código, nome, cidade/UF, fuso, ERP e situação. O
  seletor usa o cliente real de Redes, com paginação explícita, cancelamento,
  tratamento de erro e expiração. Nenhum endpoint hipotético de lojas é chamado.
- `/stores/:id/edit`: a rede fica fixa quando há dados confirmados (demonstrado
  na galeria). Sem serviço de consulta, o endereço **não** comprova identidade:
  campos vazios/desabilitados, inclusive fuso/situação sem valores presumidos.
- `/stores/:id`: faixa de disponibilidade/saúde, dois cartões Dados da loja/Agente
  e tabela Últimos lotes em largura total. Sem API, não mostra nome/código extraído
  da URL, dispositivo, heartbeat, loja offline/sem vendas ou lote fictício.
- `/stores/:id/pairing` e `/stores/:id/reinstall` continuam previstos, fora deste
  incremento. Não há geração, cópia, persistência ou revogação de credenciais.

O administrador pode abrir e preencher o **rascunho** de cadastro. Salvar fica
visivelmente desabilitado como **Previsto**, com aviso de que nada será gravado.
Não há persistência local, temporizador de sucesso, POST/PUT nem fallback para
mock. Suporte vê a faixa somente leitura, sem ações de criar/editar/parear,
inclusive nas URLs diretas. A aba Lojas da rede abre o formulário como navegação,
não como mutação ou concessão de acesso.

Cancelar, menu, Minha conta, logout e histórico usam a proteção compartilhada
de descarte, com texto **nesta loja**; recarregar/fechar a aba usa beforeunload.
A seleção de fuso no novo rascunho é intenção de configuração, não inferência
do horário do ERP ou atribuição a uma loja existente.

## Galeria de desenvolvimento

`/__qg-design` agora usa **os mesmos componentes** para QG-Lojas, QG-Loja-Form e
QG-Loja. `StorePreview.tsx` contém exemplos explicitamente sintéticos, separados
da composição autenticada e eliminados do JavaScript de produção. Não usa API,
ScopeContext, banco ou armazenamento de registros. As outras pranchetas seguem
suas implementações anteriores; pareamento/reinstalação não estão concluídos.

A galeria cobre carregamento, erro, vazio, busca sem resultado, suporte, edição,
validação, limite atingido, salvando, temas e os cinco estados de saúde. Estes
estados **não são respostas de serviços reais**. Estado ausente não é sem dados;
sem vendas não é offline. O exemplo offline tem heartbeat antigo; o exemplo
atrasado mantém heartbeat recente. Não se deduz saúde de ausência de registros.

`StoreScreens.tsx` recebe somente o estado de apresentação; `Stores.tsx` compõe
permissões reais e o seletor de redes, sempre com consulta de lojas indisponível.
A galeria não fornece identidade, sessão ou dados à composição autenticada.

## Limites e próxima integração

Cadastro real exige antes contrato/API autenticados, unicidade de código por
rede, rede imutável, revisão/conflitos, auditoria e **MaxStores transacional**, com
limites e overrides vivos. Nenhum desses controles é substituído pelo estado
visual limite-atingido. O código da loja é preenchido manualmente conforme o ERP;
não foi estendida a geração automática de códigos de planos às lojas.

Saúde, versões, lotes e último heartbeat dependem dos serviços ainda pendentes.
Não há conexão browser→ERP, extração, consulta nova aos dumps ou alteração de
identificadores/mapeamentos operacionais. Os dados de tela de exemplo não são
cadastros autorizados nem identidade de loja.

## Verificação

Regressões cobrem composição de três cartões/duas colunas, seleção real de rede,
descarte de rascunho, consulta ausente versus vazia, ausência de identidade a
partir da URL, suporte, bloqueio de gravação, temas e larguras 320/390/1024/1440.
A travessia das 125 pranchetas continua sem chamadas API. Capturas e comparações
com HTML original ficam ignoradas, em caminhos privados; não são aceite humano
pixel-perfect nem evidência de funcionamento dos serviços faltantes.

Validação local: **84 testes unitários / 20 testes de navegador**, TypeScript,
ESLint/Prettier, build de produção e auditoria de dependências. O JavaScript de
produção não contém as sentinelas dos fixtures de dispositivos/lotes da galeria.
A atualização local recompõe apenas o HQ; API, roles, credenciais, passkey do
operador e bancos/volumes não são alterados.

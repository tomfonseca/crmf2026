# M1 — emissão de códigos de pareamento

O QG pode **emitir, consultar metadados e revogar códigos por loja**. Este
incremento não registra dispositivos e não entrega o protocolo de consumo, token,
instalador, heartbeat ou ingestão do M3. Não executar instruções de exemplo de MSI
como se houvesse um instalador funcional. Código emitido não é agente instalado,
loja pareada, conectividade com ERP nem dados sincronizados.

## Fluxo e contrato

Detalhe da loja → **Códigos de pareamento** (`/stores/:id/pairing`). Identidade,
rede e revisão vêm do GET real de loja; URL não comprova existência. Suporte
consulta metadados; somente administrador de plataforma autenticado com MFA emite
ou revoga. Não há bearer, endpoint público de emissão ou nova chave de custódia.

- `GET /v1/hq/stores/{id}/pairing`: 200 `{}` se nenhum código foi emitido; caso
  contrário `{current:{id,store_id,status,expires_at}}`. Nunca devolve código,
  digest, ator ou referência de segredo. Estados: `pending`, `used`, `revoked`,
  `expired`, `invalidated`; o estado é calculado no banco, não pelo relógio do
  navegador. `used` reflete registro histórico, não consumo implementado aqui.
- `POST` no mesmo caminho: JSON estrito `{store_version,previous_id}`. `previous_id`
  é UUID canônico do último código ou string vazia se nenhum; não é idempotência.
  Retorna 201 com `{current,code}` **uma vez**, só após commit. Concorrência ou
  revisão antiga: 409; erro exige atualizar dados antes de outra decisão manual.
- `DELETE /v1/hq/stores/{id}/pairing/{pairing_id}`: sem corpo/query; 204 só se
  revogou exatamente o código não utilizado daquela loja. Usado/já revogado ou
  id de outra loja não alteram o código atual. Não revoga dispositivo. Confirmação
  explícita na tela; Origin e `X-CRMF-Request: 1` obrigatórios nas mutações.
- Todas as respostas seguem no-store, erros redigidos e escopo fresco existentes.
  Não enviar código por URL, query, auditoria, telemetry ou logs.

## Persistência, limites e ciclo de vida

Migração forward-only **00014** estende `core.pairing_codes` sem reescrever
migrações aplicadas: UUID de referência, revisão de loja e marcador de revogação.
Identidade/hash/validade são imutáveis; marcadores terminais já preenchidos não
podem ser apagados/redefinidos. Registros legados sem revisão são `invalidated`,
sem inventar correspondência histórica. A emissão revoga todos os anteriores não
utilizados na mesma transação. Alterar a configuração da loja incrementa sua
revisão e invalida o código anterior, mesmo que a loja depois seja reativada.

Código canônico: **8 símbolos base32 uniformes**, alfabeto
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, gerados com `crypto/rand` (40 bits). Só
SHA-256 de 32 bytes é gravado. Validade é calculada no banco como **72 horas** a
partir do instante de inserção, após adquirir locks, não do início da espera.
Colisão/erro de persistência falha fechado com rollback; não há retry automático
nem código parcial. Limite de exibição de 60 segundos não reduz o TTL no banco.

Ordem de locks: **janela do emissor → tenant → assinatura/plano** (mesma política
viva de Lojas); atualização de loja já serializa pelo tenant. Inserção do código,
revogação dos anteriores, contador do emissor e auditoria são atômicos. Requer
loja ativa e rede trial/active, pronta e com assinatura disponível. Revogar código
continua permitido se rede/loja deixar de estar ativa. Código não reserva nova
loja nem muda quota. Dispositivos existentes ficam intocados até o futuro consumo.

- Uma emissão por loja por minuto; até cinco emissões confirmadas por operador
  por janela fixa de um minuto, em tabela específica de contadores. A API não ganha
  leitura de `audit_log` para calcular limites; a auditoria continua append-only.
- Limites persistem entre réplicas/reinicializações. Erro/rollback não consome cota
  de emissão nem invalida o código anterior. 429 inclui `Retry-After: 60` (conservador).
- Auditoria contém somente ator autenticado, rede/loja, ação e UUID do código; sem
  código, digest, nome comercial, contato ou chave do dispositivo.
- A tabela de contadores é limitada aos operadores emissores, sem criação pública
  de atores. Retenção de operadores removidos pode limpar seus contadores por job
  privilegiado futuro; nenhum expurgo de usuários existentes ocorre neste incremento.

**Obrigação para o M3:** código curto não é credencial geral nem senha. Antes de
expor consumo anônimo, implementar limites distribuídos de tentativas/IP e globais,
resposta sem oracle de loja/rede, comparação/consumo atômico com `used_at IS NULL`,
`revoked_at IS NULL`, validade, revisão e política atuais; tenant/loja derivam do
registro, nunca do corpo. Registrar chave Ed25519 e revogar dispositivo anterior
na mesma transação. SHA-256 não transforma 40 bits em proteção forte contra busca
offline após comprometimento do banco. Não habilitar um consumidor parcial.

## Browser e evidência

Segredo fica apenas no estado local do componente, fora do TanStack/cache/storage/
URL. Limpeza ao sair, ocultar, mudar aba, `pagehide` ou após 60 s. Resposta tardia
recebida após perder visibilidade não revela código; unmount aborta requisição e
ignora resultado. Copy exige ação humana; área de transferência/histórico do SO
não é controlado pelo QG. Atualizar relê também configuração/revisão da loja;
nenhum polling ou renovação ociosa de sessão é introduzido.

`exercisePairing` amplia a integração PostgreSQL/HTTPS de Lojas com provisionamento
real isolado: quatro emissões concorrentes → **1 aceita / 3 conflitos**, hash/TTL,
GET sem segredo, cooldown/limite por operador, revisão, substituição, revogação,
invalidação de configuração, escopo/CSRF, JSON estrito e auditoria sem segredo.
Fixtures são sintéticos e removidos; prova de `used`/consumo do agente é trabalho
futuro. Browser usa contratos interceptados e cobre confirmação, ida/volta sem
recuperar código, erro sem retry, revisão atualizada, suporte, 320 px e storage.
Vitest cobre StrictMode, resposta tardia após pagehide e expiração sem polling.
Conjunto local: **104 testes unitários frontend / 23 fluxos de navegador**,
Go completo, integração real e lint/build/security aprovados. Preflight novo
foi reproduzido vermelho (POST aninhado negado pelo guard antigo GET/PUT) e
corrigido com rotas/métodos exatos, sem ampliar origens ou permitir PUT indevido.
API implantada confirma POST/DELETE preflight 204, origem do Dash 403 e anônimo
401. Probe de UI implantada usa apenas contratos GET interceptados, zero mutações;
não equivale a aceite nativo do operador nem de agente/instalador/Azure.

[ADR 0010](../adr/0010-pairing-issuance-without-agent-consumption.md).
M1 continua parcial; aprovação humana/CI/demo e serviços pendentes não são
substituídos pela emissão do código.

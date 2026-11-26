# Pedido de recuperação — captura local opt-in

## Escopo comprovado

Dois realms: POST /v1/auth/password/forgot e /v1/hq/auth/password/forgot.
UI /login/esqueci-senha e /esqueci-senha, com cliente gerado, confirmação genérica,
sem refletir e-mail, criar sessão ou remover MFA. O emissor por UUID permanece
privado, agora chamado somente pelo consumidor da fila. Nenhuma CLI emite links.

**Não é entrega pública/ACS ou aceite M1.** A VPS permanece web175198a/API503.
MAILPIT nunca é fallback de produção: configuração fora de development falha.
A captura só envia para UUID canônico não nulo @example.invalid; recusa contas
reais antes do lookup/emissão. Não testar o administrador existente.

## Antienumeração e indisponibilidade

Intake não consulta users/grants, não emite token e não chama transporte.
Resposta vazia202, sem cookie, total/ID/estado/rate hint ou destinatário:
conta existente, inexistente, inelegível, realm errado, coalescência e limite
produzem o mesmo ack. Não é confirmação de conta, elegibilidade ou envio.

JSON<=8KiB estrito, sem query/bearer/duplicados/null/extras/compressão; Origin e
X-CRMF-Request exatos, IP somente de proxy explicitamente confiável.400/415/403
são erros de contrato/origem;503 significa configuração/armazenamento global
indisponível, antes de qualquer lookup. Não fabricar202 se o registro não pôde
ser confirmado. Essa precisão ao “sempre202” está no ADR0016 e na spec.

## Persistência, limites e privacidade

- auth.recovery_requests: destinatário AEAD, AAD UUID+realm; nunca token ou IP.
- HMAC derivado da custódia original, com domínios separados para índices.
  Limites compartilhados por processos/realms:120/min global,10/min IP,
  3/h destinatário. IP IPv4-mapped é normalizado. Não consome lockout/login.
- Locks global→IP→destinatário; mesmo código para endereço desconhecido.
  Capacidade1024 vivos por custódia; coalescência por destinatário+realm.
- TTL fila15min; token30min somente após claim/eligibilidade/lock da identidade.
- worker com outra chave não pode reivindicar ou descartar a fila desta chave.
  Rotacionar chave não é forma de recuperar acesso; preservar o original.
- Emissão verifica novamente e-mail esperado e password_epoch<=pedido dentro
  do lock da identidade. Pedido anterior à troca de senha não invalida uma
  prova mais recente. E-mail/política mudados impedem envio incorreto.
- Claim confirmado ANTES de emitir/enviar. pending→claimed→finished apenas;
  não há rescue/retry do claim, mesmo após crash/timeout/recibo inválido.
- finished elimina ciphertext; falha no scrub mantém claimed, sem reenvio.
  Manutenção API/auth-mail a cada5min encerra pendentes expirados e claims
  abandonados>2min, limpa metadados>1dia e buckets>2h. Retenção depende do
  banco estar disponível; não prometer eliminação instantânea numa falha.
- Não há status/listagem pública nem logging de email/token/link. O pedido
  HTTP não informa resultados da etapa assíncrona.

00017 criou fila/limites/guards. Após a primeira prova local,00018 acrescentou
namespace de custódia e substituiu o índice de claim: histórico aplicado não foi
reescrito.00019 corrigiu defaults com statement_timestamp(), pois dois
clock_timestamp() poderiam violar o CHECK estrito de15min; teste red→green sem
desabilitar guards.00018 termina pedidos pré-feature não vinculados, sem tocar senha,
passkeys/sessões de operador. Migrações são forward-only, aplicadas pelo migrator,
não por API/auth-mail. core/worker comum não recebem acesso auth.

## Operação de desenvolvimento

Pré-requisitos: ambiente auth existente, custódia original intacta, migrations
control até00019 aplicadas pelo processo migrator. O opt-in NÃO cria chave,
reexecuta bootstrap, migra implicitamente ou reinicia bancos/volumes:

```sh
python scripts/tasks.py recovery-dev
```

Sobe/reconstrói apenas mailpit/api/auth-mail/hq/dash. auth-mail é processo separado
com auth role/key/origens locais, sem URL migrator/analytics, tenant custody ou
porta publicada. Uma claim/tick1s, operação<=15s, transporte<=5s/sem proxy-redirect.
Não confundir “processo pronto” com entrega de mensagem; falhas são redigidas e
não repetem claim. AUTH_RECOVERY_MAILPIT_URL é opt-in; sem ele intake retorna503.

Mailpit em http://localhost:18025 é **sem autenticação**, acessível a processos
locais que alcançam loopback. Somente fixtures descartáveis, sem relay/forward.
Bridge dedicada não é isolamento completo de saída. Não publicar mensagens,
prints, recipients, PINs, tokens ou conteúdos de links. Desligar opt-in recriando
API sem compose.recovery.yaml e parando auth-mail, preservando DB e custódia.

## Evidência

- PostgreSQL: coalescência, concorrência4→1, limites persistentes nos três níveis,
  destinatário cifrado/AAD, custódia diferente, crash/imutabilidade, desconhecido,
  realm incorreto, stale epoch/recipient e entrega incerta sem retry.
- HTTPS real nos dois realms: pedido202 sem emissão síncrona→worker→Mailpit
  real→fragmento recebido→resetHTTP204→novo login exige a MESMA passkey virtual.
  Nenhum SQL/CLI fabrica o token dessa prova; só prepara identidades descartáveis.
- React: StrictMode, dupes, limpeza do DOM, transporte202 exato, ausência de
  persistência, pagehide/unmount e incerteza. Chrome: quatro testes com API
  interceptada para202/503 nos dois realms, temas/mobile320, sem cookies/storage.
  Esta prova UI é separada do teste GoHTTPS/Mailpit; não é browser físico/ACS.
- CI executa round trips Mailpit de kernel/fila e HTTPS separadamente.

Restam: ACS/identidade gerenciada/domínio e aceite do provedor, observabilidade/
capacidade/restore em ambiente aprovado, prova completa de Chrome sem interceptação
com worker/processos reais e autenticador físico, convites, gestão de fatores e
autorização completa por planos. Não declarar autenticação100% nem M1 aceito.

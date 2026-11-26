# Núcleo interno de recuperação de senha

## Entregue — não é um fluxo público

O método **privado** issuePasswordReset e Engine.ResetPassword implementam
emissão/consumo transacionais no schema auth. Não há rota, CLI, botão ou job
automático para emitir links por id de usuário. O [pedido/fila com captura local opt-in](recovery-request.md) agora chama o emissor
somente no consumidor. Entrega pública ACS e aceite operacional continuam pendentes. O
[consumidor HTTP e formulário](password-reset-web.md) já usam este kernel nos
dois realms, sem expor o emissor.
Não use SQL/bootstrap para obter link ou recuperar o administrador existente.

- Token criptograficamente aleatório de 32 bytes, canônico base64url, com SHA-256
  no banco. O segredo bruto só sai no MailNotice em memória depois do commit,
  para entrega; o aviso tem formatação/JSON/slog redigidos.
- Emissão requer identidade ativa com senha definida, grants compatíveis com o
  realm e política atual. Usuário convidado/desativado, tenant suspenso, loja
  indisponível ou realm errado não recebem token.
- TTL de 30 minutos medido pelo relógio do banco depois do lock da identidade.
  Um único token não consumido por usuário/realm; emitir outro invalida o anterior.
- Prova vinculada a usuário, finalidade password_reset, realm e password_epoch.
  Alterar e-mail, senha/epoch, estado, flags MFA ou grants invalida tokens.
- Locks identidade → token em emissão/consumo; concorrência não permite consumir
  duas vezes. A expiração é novamente conferida no UPDATE após o Argon2.
- Consumo aplica o limite compartilhado de 20 tentativas/IP/minuto, inclusive
  para provas inválidas, usando o bucket persistente já existente.
- Ausência, expiração, replay, tipo/realm/epoch incorreto e identidade/política
  inelegível produzem ErrResetToken, sem incluir token, e-mail ou senha no erro.
- Política de senha existente (Argon2id, denylist, limites Unicode/bytes).
  Senha inválida não consome a prova nem prolonga a validade.
- Sucesso troca o hash/epoch e limpa bloqueio por falhas de senha. A posse do link
  é uma prova de recuperação da senha, **não prova MFA**.
- Triggers encerram todas as sessões e desafios antigos em todos os realms,
  invalidam demais tokens e preservam exatamente os registros de passkey e
  códigos de recuperação. Não cria sessão/principal nem remove fatores.
- Emissão e consumo têm auditoria na mesma transação, somente alvo UUID e realm.
  Ator NULL representa recuperação por link, não uma sessão autenticada.
- PruneExpiredState também remove tokens expirados há mais de um dia. Continua
  agendado na API/auth-mail com contexto limitado, a cada5min.

## Migrações e permissões

00015 estende auth.user_tokens com realm/epoch, limite de duração, índice único
de token vivo e guards de identidade/estado terminal; invalida tokens legados
sem vinculação implementada, sem mudar senhas, sessões ou fatores existentes.
00016 remove um índice de ordenação redundante: 00015 já havia sido aplicado
na validação e não foi reescrito. O índice único usuário/realm cobre o lookup.

Ambas são forward-only. Não há nova chave/custódia nem privilégio para core,
worker ou provisioner ler auth. O administrador/passkey existente nunca é fixture.

## Prova local

Testes PostgreSQL reais cobrem hash/TTL/substituição, política, expiração,
tipos/realms/epoch, mutações de identidade/grants, concorrência 4→1,
limite persistente de IP e irreversibilidade do estado consumido. Nos dois
realms, um autenticador virtual descartável demonstra que a mesma passkey e os
dez códigos continuam válidos; sessões/desafios antigos não sobrevivem.

Com Mailpit iniciado, a prova adicional passa pela mensagem realmente capturada:

```sh
python scripts/tasks.py mail-dev
MAILPIT_TEST_URL=http://localhost:18025 go test -p 1 -tags integration ./internal/server/auth -run '^TestPasswordResetKernel' -count=1
```

A limpeza remove somente destinatários sintéticos UUID. Não usar contas,
passkeys, códigos ou credenciais de operador. Isto não testa entrega externa ACS,
recuperação humana do operador ou TLS público.

## Próximas unidades obrigatórias

- [x] Pedido local opt-in com resposta uniforme e processamento desacoplado, para não
  revelar existência por conteúdo, status, latência de lookup ou envio.
- [x] Limites persistentes por identificador/IP/global e fila/entrega limitadas;
  não expor o emissor privado ou enviar link a um destinatário escolhido no corpo.
- [x] Política explícita de falha/crash/entrega incerta: sem retry/reemissão cega
  que substitua tokens ou prometa rollback de e-mail já aceito.
- [x] HTTP com JSON estrito, CSRF/origem exatos, no-store, cookies limpos e erros
  redigidos; frontend com token somente em memória e remoção imediata da URL.
- [ ] ACS com identidade gerenciada/domínio validado e aceite do provedor.
- [ ] Convites/grants/quota de usuários e aceite separado, sem sessão automática.

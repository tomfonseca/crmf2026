# E-mail local — base para convites e recuperação

## Entregue

- `python scripts/tasks.py mail-dev` sobe somente Mailpit, via
  `compose.mail.yaml`; não sobe/reconfigura API, bancos, ERP ou bootstrap.
- UI/API em **http://localhost:18025**, bind exclusivamente 127.0.0.1.
  SMTP não é publicado no host e escuta apenas loopback dentro do container.
- Imagem v1.34.0 fixada por digest; processo 10001:10001, read-only, sem
  capabilities, limite 128 MiB/64 processos. Banco no tmpfs, sem volume persistente,
  máximo 100 mensagens e retenção por idade configurada em 1h.
- Sem relay/forward/webhook externo configurado; verificação de versão desativada,
  CSS/fontes remotos bloqueados e logs quiet. A rede bridge separada **não**
  representa isolamento completo de saída da rede; não publicar esta captura.
- Modelos pt-BR texto/HTML em `internal/server/auth/templates`, sem assets
  externos. Convite: 72 horas; redefinição: 30 minutos. A validade efetiva ainda
  depende do ciclo transacional, não do envio/template. Reset já tem kernel e
  consumidor; o ciclo de convite permanece pendente.
- `auth.NewLocalMailer` exige development explícito, destino HTTP com porta em
  localhost/127.0.0.1/mailpit e origens de frontend localhost distintas.
  Não aceita origem de cabeçalho HTTP, endereço remoto ou fallback de produção.
- Links por realm: QG /convite e /nova-senha; Dash /login/convite e
  /login/nova-senha. Token opaco canônico de 32 bytes fica em #token=...,
  não na query recebida pelo servidor HTTP.
- Um destinatário validado, sem display-name/control chars; remetente fixo
  no-reply@crmf.invalid. Tipos/realm/token inválidos falham antes do transporte.
- HTTP sem proxy de ambiente ou redirects, até quatro envios simultâneos,
  timeout total de 5s e resposta limitada a 8 KiB; sucesso exige recibo JSON.
  Não há retry automático. Erro/abortamento pode ocorrer após aceitação da
  mensagem: não garante rollback nem autoriza repetir silenciosamente.
- Erros redigidos; formatação comum de MailNotice, JSON e slog não revela
  destinatário/token. Isso não autoriza logar seus campos individualmente.

## Uso e prova local

```sh
python scripts/tasks.py mail-dev
MAILPIT_TEST_URL=http://localhost:18025 go test -tags=integration ./internal/server/auth -run '^TestAuthMailCapture$' -count=1
```

O teste envia quatro mensagens com endereços .invalid e tokens aleatórios
**sem qualquer registro no banco**: convite/reset nos dois realms. Consulta somente
seus destinatários UUID e compara assunto/texto/HTML realmente capturados.
A limpeza apaga somente essas mensagens sintéticas, nunca a caixa inteira.
Não imprime os tokens nem utiliza administrador, sessão ou passkey reais.

A UI é uma caixa de captura de desenvolvimento sem autenticação própria:
qualquer processo/usuário com acesso ao loopback pode ler os links. Use somente
identidades de teste descartáveis. Não exponha a porta, configure relay, use
credenciais reais, capture uma caixa de produção ou publique screenshots/corpos
de mensagens.
Parar/recriar o container descarta seu tmpfs. Não há backup/restauração de e-mails.

No Windows/Rancher, bridge internal impediu o encaminhamento da porta ao host
apesar do healthcheck interno passar; bridge normal dedicada com bind loopback
permitiu a prova real. Não foram alterados firewall, reservas de portas ou
outras redes/serviços para contornar o problema.

## Explicitamente pendente

O transporte isolado não faz mutações. O [serviço de recuperação local opt-in](recovery-request.md)
agora conecta fila, HTTP, formulário e captura; aceite de convite e envio público
ACS continuam indisponíveis. O
[consumidor HTTP/form de reset](password-reset-web.md) já funciona com prova
válida, sem criar sessão; o novo serviço separado liga o pedido à entrega local.

Este módulo de transporte não emite/consome tokens nem altera identidades.
O [núcleo interno separado](password-reset-kernel.md) já implementa prova de
recuperação no banco e tem teste Mailpit com identidade descartável; emissão
continua privada, agora chamada pelo consumidor da fila local. O formulário consome a prova, não
emite links. Não importar
ou resetar o administrador existente para testar o fluxo.

Próximas unidades:

- [x] Recuperação local opt-in com resposta uniforme, limites persistentes e
  prevenção de enumeração; não enviar se a conta/realm/política não autorizarem.
- [x] Núcleo interno de consumo atômico, prazo de 30 min, uso único e revogação
  de sessões/desafios, preservando passkeys e códigos de recuperação.
- [x] Contratos HTTP gerados e formulário de reset que mantenha o token apenas em
  memória, removendo-o da URL antes de qualquer navegação externa.
- [ ] Convite autorizado, quota de usuários/grants/lojas, validade de 72h e aceite
  transacional sem sessão automática.
- [ ] Entrega ACS via identidade gerenciada, domínio verificado e aceite real do
  provedor; nunca reutilizar Mailpit ou development como fallback público.

O Keycloak legado permanece inalterado até o cutover completo; este incremento
não representa aceite de e-mail externo, convites completos ou M1 aceito.

# M1 — segurança da própria conta

Minha conta no QG (`/minha-conta`) e no login do cliente
(`/login/minha-conta`) agora integra as abas **Senha** e **Sessões** à API real.
Não é recuperação por e-mail, gestão administrativa de usuários nem gestão de
passkeys. Nenhuma senha, passkey ou código do operador é alterado por deploy,
migração ou teste.

## Contrato e autorização

| Operação | Cliente | Plataforma |
| --- | --- | --- |
| Trocar senha | POST /v1/me/password | POST /v1/hq/me/password |
| Listar sessões | GET /v1/me/sessions | GET /v1/hq/me/sessions |
| Encerrar sessão | DELETE /v1/me/sessions | DELETE /v1/hq/me/sessions |

- Sessão opaca em cookie HttpOnly/Secure/SameSite Strict do realm correto.
  Origin exata + `X-CRMF-Request: 1` em mutações; bearer não é aceito.
- Todos os papéis podem administrar **somente sua própria conta**; suporte não
  precisa de privilégio administrativo para trocar a própria senha.
- O proprietário vem do hash do cookie, nunca de um seletor fornecido pelo cliente.
  Conta ativa, sessão viva, grants/rede e política MFA são revalidados sob lock
  **usuário → sessão**, na mesma transação da operação.
- Nenhuma nova permissão de banco, migração ou custódia. Somente o módulo auth
  importa suas consultas SQLC; o catálogo e os workers continuam sem acesso.
- JSON estrito limitado a 8 KiB: campos obrigatórios, sem null, extras, duplicatas,
  compressão ou documentos concatenados. Query desconhecida/repetida é rejeitada.
  Respostas no-store, erros redigidos, sem eco de credenciais.

## Senha atual obrigatória

Corpo: `{current_password, new_password}`. A política existente mantém Argon2id,
admissão de memória, mínimo de 12 caracteres Unicode, máximo de 1024 **bytes**
UTF-8 e denylist local. Não há trim, normalização ou atualização para a mesma
senha. Não se aceita ID de usuário nem link/token de recuperação neste endpoint.

A prova incorreta responde 400 `current_password_invalid`, **não** expira uma
sessão válida. Usa os contadores persistentes da identidade, bloqueios graduais
após cada cinco falhas e o limite de IP existente (20 tentativas/minuto).
Bloqueio ativo responde 429 e não é prorrogado por tentativas bloqueadas.
A listagem/saída de uma sessão já válida continua possível durante esse bloqueio.

Troca bem-sucedida atualiza hash/época e zera falhas sob o lock de identidade;
os triggers existentes revogam **todas** as sessões e invalidam desafios de login
e de passkey na mesma transação. Auditoria `auth.password_changed` e commit vêm
antes do 204 e da limpeza dos cookies do realm. Credenciais de passkey seladas,
contadores e códigos de recuperação permanecem intactos. Novo login continua
exigindo a passkey conforme a política. Concorrentes com sessão/senha antigas
não podem sobrescrever a nova senha.

A UI confirma a nova senha, limpa os campos logo ao submeter, impede duplicatas
e não mantém segredos em cache, URL ou armazenamento. Sucesso encerra o escopo
local e pede novo login. Resposta incerta não tem retry automático: os controles
de escrita ficam bloqueados; saia e confira o acesso com a nova senha antes de
decidir repetir. Abortar a requisição não promete rollback no servidor.

## Sessões próprias, não inventário de dispositivos

GET retorna `{items, next_cursor?}`: no máximo 100 sessões não revogadas, ainda
dentro dos prazos absoluto e de inatividade, ordenadas por UUID descendente;
`?after=<uuid>` percorre páginas sem varrer outros usuários/realms.
Cada item contém somente referência UUID, criação, última atividade, expiração
por inatividade/absoluta, indicador da sessão atual e MFA confirmada.
A referência **não é** o token de autenticação. Nunca retorna hash/token, IP,
user-agent, senha, desafio ou credencial. Não há contagem total fabricada.
Horários são reais; a tela usa o fuso do navegador e não atribui sistema ou
dispositivo que a API não conhece.

DELETE exige `{session_id}` e confere dono + realm no banco. ID inexistente ou
de outra conta responde o mesmo 404. Repetir a revogação de uma referência
própria já encerrada responde 204, sem duplicar `auth.session_ended`.
Encerrar a sessão atual limpa cookies e exige login; encerrar outra sessão
mantém a atual. A revogação impede a próxima autenticação, não desfaz requisições
de negócio já autorizadas. Não existe ação em lote neste incremento.

A lista só carrega ao abrir a aba, atualizar explicitamente ou avançar página.
Sem polling, heartbeat ou keepalive oculto. Consultas explícitas contam como
atividade normal da sessão. Indisponibilidade não vira lista vazia. Revogação
exige confirmação, preserva foco nativo do dialog e bloqueia repetição incerta
até atualização explícita. Pedidos tardios após unmount são ignorados.

## Evidência e limites

- PostgreSQL/HTTPS real: realms/contas isolados, suporte, cursor de 103 sessões,
  CSRF/CORS/JSON estrito, revogação idempotente e da sessão atual, política de
  senha, bloqueio persistente, auditoria e senha antiga inválida.
- Teste com autenticador virtual descartável: troca preserva a credencial selada
  byte a byte e dez códigos de recuperação, invalida desafio anterior e exige
  nova assinatura da **mesma** passkey com a nova senha.
- Vitest: transporte gerado, respostas verificadas, campos limpos, StrictMode,
  erros/incerteza, abort e sucesso tardio sem recuperar escopo.
- Playwright: ambos os realms, confirmação/cancelamento, encerramento seletivo,
  troca de senha, temas e 320 px. Contratos interceptados, não aceite físico do
  autenticador do operador nem validação de Azure/provedor de e-mail.

Perfil editável, passkeys adicionais/remoção, regeneração de recuperação,
convites, recuperação de senha por e-mail, gestão administrativa de usuários,
limite transacional de usuários e aceite final continuam pendentes. M1 parcial.

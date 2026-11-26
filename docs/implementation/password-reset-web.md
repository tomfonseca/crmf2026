# Consumo HTTP e formulário de redefinição

O [emissor continua privado](password-reset-kernel.md). Não há endpoint/CLI por
id de usuário para obter links. [Pedido/fila e captura local opt-in](recovery-request.md)
já conectam solicitação e entrega. ACS/aceite público e convites não estão concluídos; não usar bootstrap/SQL para recuperar o operador.
Veja a [lista completa de fechamento](authentication-completion.md).

## Contrato

POST /v1/auth/password/reset e /v1/hq/auth/password/reset recebem somente
{token,new_password}. Realm vem da rota, identidade da prova no banco; nenhuma
sessão, identidade ou tenant fornecidos pelo cliente autorizam a operação.

- JSON <=8KiB estrito, sem campos extras/duplicados/null/trailing/compressão.
- Origem exata, X-CRMF-Request: 1, CORS por realm, contexto 10s, IP resolvido
  somente pelas redes proxy explicitamente confiáveis. Sem query ou bearer.
- Kernel aplica sua política Argon2/denylist e limite persistente de IP.
- 204 sem corpo e com expiração dos cookies de sessão/desafio **desse browser
  realm**. No banco, todas as sessões/desafios do dono da prova são revogados,
  em todos os realms; fatores/códigos permanecem intactos.
- 400 reset_token_invalid uniforme para prova inválida/stale/usada/expirada ou
  realm errado; 400 password_policy não consome a prova. 429 traz Retry-After.
- Erros e respostas não retornam token, e-mail, nome, senha ou identidade.
  Auth desabilitado/backend sem suporte permanece 404.

## Browser

Paths /nova-senha (QG) e /login/nova-senha (tenant). Aceita somente o fragmento
canônico #token=<32 bytes base64url sem padding>, sem query. Captura em ref de
memória numa layout effect, removendo query/hash do entry atual antes do paint.
Não emite pedido de “validar token” nem considera sintaxe prova de autorização.
Só o POST definitivo pode confirmar. Recarregar/back sem o fragmento exige
reabrir o link; nenhuma cópia fica em storage/cookie/cache de queries.

- StrictMode não perde o segredo na montagem simulada, nem reenvia a mutação.
- Confirmação e limites locais; denylist/política definitiva no servidor.
- Senhas saem do DOM/state ao enviar; duplo submit bloqueado.
- 400 password_policy/429 conhecidos permitem corrigir/aguardar; replay/token
  inválido termina o fluxo. Falha/timeout/resultado inesperado implica incerteza:
  segredo descartado, sem retry, orientação para conferir a nova senha no login.
- Pagehide/unmount abortam transporte sem prometer rollback; troca de realm
  descarta a prova anterior. Login após sucesso continua exigindo a mesma MFA.
- Início de tentativa descarta escopo local e cancela o restore pendente, para
  que resposta antiga de identidade não reapareça depois da redefinição.

## Evidência e limites

Testes reais Postgres/HTTPS nos dois realms exercitam consumo anônimo, política,
replay, revogação de cookie/sessão/desafio, auditoria e autenticação com a mesma
passkey. Fixtures sintéticas próprias recebem as provas; não são um emissor de
operação. O round trip Mailpit do kernel continua separado.

Testes React cobrem StrictMode, fragmentos/queries não canônicos, transporte
gerado, duplicação, incerteza, pagehide/unmount, realm e restore antigo. Dois
Playwright usam Chrome com **API interceptada**, temas/mobile320, sem storage
sensível/cookies ou sessão automática. Isso não é aceite de pedido/e-mail/form
completo, ACS, autenticador físico ou backend público.

Este consumidor não muda custódia. A fila posterior usa00017/00018. A VPS continua na imagem web175198a/API503:
nenhum endpoint/reset/login público foi ativado por esta mudança.

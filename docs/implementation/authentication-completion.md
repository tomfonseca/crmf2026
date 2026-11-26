# Fechamento de autenticação e autorização

Escopo solicitado: login, processos de passkey, esqueceu senha e acesso por planos.
**Ainda não está 100% concluído.** Não confundir kernel, mock de navegador,
integração local e aceite público. Cada unidade fecha com evidência própria.

## Critérios de conclusão

| Rotina | Já comprovado | Falta fechar |
| --- | --- | --- |
| Login | Argon2/denylist, lockout/IP, dois realms, cookies, MFA obrigatório QG, sessões/revogação, UI com API real local | integração de assinatura/plano na admissão e em toda requisição tenant; aceite público com custódia aprovada |
| Passkeys | enrollment/assertion nativos, origem/RP/UV, replay, recuperação por código após senha, fatores preservados após troca/reset | gestão segura de múltiplas chaves/remoção, fatores/códigos na conta, política MFA de rede; aceite físico público |
| Esqueceu senha | kernel30min, HTTP/form reset, [pedido/fila protegida e entrega local](recovery-request.md), limites identificador/IP/global, claim único/sem retry incerto, HTTPS+Mailpit+mesma passkey | ACS/aceite público, capacidade/operabilidade e browser completo sem interceptação com processos reais |
| Acesso por planos | EffectiveLimits principal-only, overrides, estados, módulos; quota transacional de lojas | login/me e guards HTTP/client, alterações de assinatura/plano com efeito imediato, quota de usuários, retenção/datas na implementação das rotas de dados |

## Unidades de trabalho

- [x] Inventário e critérios explícitos, sem substituir as bases existentes.
- [x] Reset HTTP nos dois realms: JSON estrito, origem/CSRF, rate limit, erros
  redigidos, sem sessão automática, remoção dos cookies após sucesso.
- [x] Formulário real de nova senha: fragmento capturado/removido imediatamente,
  memória somente, confirmação/política, sem retry de mutação incerta.
- [x] Solicitação de recuperação local opt-in: resposta 202 sem lookup/envio síncrono que
  revele existência; fila/limites e manutenção com armazenamento protegido.
- [x] Pedido HTTP → fila → Mailpit → reset HTTP → login com mesma passkey,
  nos dois realms, com identidades descartáveis; UI/browser validado separadamente.
- [ ] Entrega pública e teste completo browser pedido → e-mail → formulário → login,
  sempre com a mesma passkey; não usar administrador real como fixture.
- [ ] Gestão de fatores e política MFA, com prova atual, auditoria e sem remover
  último fator obrigatório ou resetar autenticador para desbloquear testes.
- [ ] Autorização por assinatura/plano em todo acesso real e menu, sem filtros
  por tenant fornecidos pelo cliente ou inventar endpoints/dados analíticos.
- [ ] Testes finais cruzados por papel/realm/tenant/loja/plano e falhas/incertezas.
- [ ] Aceite público de backend, email/provedor e autenticador físico.

## Restrições preservadas

Sem bootstrap/reset/re-enrollment do operador existente, cópia de chaves locais
para VPS, APP_ENV=development público, bypass de MFA/bearer ou merge automático.
O edge HTTPS já público continua com API503 até implantação segura do backend.
ACS/identidade gerenciada/Key Vault e recursos pagos exigem configuração e aceite
próprios. Formulários não podem transformar indisponibilidade em sucesso.

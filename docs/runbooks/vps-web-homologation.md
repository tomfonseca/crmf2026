# VPS de homologação — somente entrada web

O operador forneceu uma VPS e os domínios qg.crmfarma.app.br,
dash.crmfarma.app.br e api.crmfarma.app.br. Veja [ADR 0012](../adr/0012-vps-homologation-web-edge-only.md).
Isto **não** implanta a API autenticada nem conclui M1/M8 ou a infraestrutura Azure.

## O que esta imagem faz

- Compila React/TypeScript em modo production no CI/workstation; runtime contém
  somente Caddy e os arquivos dist, nunca Node, pnpm, Vite ou código Go.
- Imagens base fixadas por digest; COPY restrito a fontes web e configuração de
  entrada. Não copia repositório inteiro, .tools, dumps, arquivos .env, chaves,
  referências privadas ou resultados de navegador para a imagem final.
- QG serve a SPA e deep links; não autoriza acesso quando a API está ausente.
- Dash redireciona / para /login; só publica login/subrotas e assets.
  /meu-desempenho e /minhas-metas retornam indisponível neste host. O dashboard
  sintético local continua separado e inalterado, não vira fallback de negócio.
- API retorna **503 deployment_pending** em todos os caminhos/métodos, inclusive
  healthz/readyz e tentativas de autenticação. Não cria cookie, usuário ou registro.
  CORS somente para as duas origens HTTPS exatas, sem wildcard.
- Cabeçalhos no-store no HTML/API, CSP, proteção contra frames e HSTS de um dia
  sem includeSubDomains/preload. Assets com hash têm cache imutável.
- Bloqueia .env/.git, previews DEV, fontes, node_modules e endpoints Vite;
  hosts desconhecidos não recebem a SPA. Sem directory browsing.
- Processo 10001:10001, filesystem somente leitura, sem docker socket, sem
  segredos/DB, limites de 192 MiB/0.75 CPU/100 processos. Única capability
  NET_BIND_SERVICE. Certificados/estado Caddy ficam em volumes exclusivos.
- Healthcheck interno só confirma **web_edge_only**, não prontidão do backend.
  Porta 2015 é loopback dentro do container; nenhuma API administrativa Caddy.

## Build e ensaio local

Execute na raiz, fora da VPS de 1 vCPU / 2 GB:

```sh
docker build -f deploy/vps/Dockerfile.web -t crmf-web-edge:hml-<commit> .
```

Use tag de release única/digest; nunca promova automaticamente main ou outra
branch. Não mescle/retarget a pilha de PRs para contornar revisão.

Para ensaio, defina as variáveis públicas:

```sh
export CRMF_EDGE_IMAGE=crmf-web-edge:hml-<commit>
export QG_SITE=http://qg.crmfarma.app.br
export DASH_SITE=http://dash.crmfarma.app.br
export API_SITE=http://api.crmfarma.app.br
docker compose -p crmf-web-edge-test -f deploy/vps/compose.web.yaml up -d --wait --wait-timeout 30
CRMF_WEB_EDGE_URL=http://127.0.0.1:18081 python -m unittest discover -s tests -p test_web_edge.py -v
docker compose -p crmf-web-edge-test -f deploy/vps/compose.web.yaml down
```

Os defaults de bind são **127.0.0.1:18081/18443**. Não use o Compose de
desenvolvimento, portas 5173/5174 ou AUTH_KEY_FILE nesta VPS.
Os testes exigem loopback HTTP e cobrem a imagem real, cache, assets, deep
links, bloqueio DEV/hosts/demos, 503 em todos os métodos e CORS exato.
CI também constrói e escaneia a imagem (HIGH/CRITICAL com correção disponível).

## Preparar na VPS enquanto o DNS propaga

Transfira somente a imagem compilada e deploy/vps/compose.web.yaml, nunca o
checkout ou a árvore .tools. Autenticação SSH é por chave criptografada do
operador, com host key pinada e sem agent forwarding; a chave privada não sai
da workstation. A senha/SSH do host não é alterada por este deploy.

Carregue a imagem via docker save/load e coloque os arquivos operacionais sob
/opt/crmf/web/releases/<commit>, root:root 0700. O arquivo .env desse diretório
contém somente variáveis públicas de imagem/bind/sites. Teste o container com
os sites HTTP e bind loopback acima, usando Host: qg.crmfarma.app.br etc.
Nenhuma porta pública web é necessária para esse ensaio. Não remova volumes
Caddy ao atualizar ou reverter; não reinicialize bancos ou custódia existente.

## Publicação HTTPS (etapa separada)

1. Rode na VPS `bash check-public-dns.sh`: ambos os resolvers devem devolver
   somente A=108.174.144.89 para os três hosts e nenhum AAAA enquanto IPv6 não
   estiver configurado. Erro bloqueia publicação, sem retry/sleep cego.
2. Confira CAA caso exista restrição de CA, liberação TCP 80/443 no provedor,
   e ausência de outro serviço nessas portas. Não mude nameservers/e-mail.
3. Altere somente variáveis públicas:
   EDGE_BIND_ADDRESS=0.0.0.0, EDGE_HTTP_PORT=80, EDGE_HTTPS_PORT=443;
   QG_SITE=https://qg.crmfarma.app.br, DASH_SITE=https://dash.crmfarma.app.br,
   API_SITE=https://api.crmfarma.app.br.
4. Recrie o mesmo projeto Compose e mantenha os volumes. Caddy obtém/renova
   certificados públicos automaticamente. Valide TLS/cadeia/hostname por acesso
   externo normal, **sem -k**. HTTP deve redirecionar para HTTPS.
5. Confira novamente 503 de API/readiness, login em indisponibilidade, bloqueio de
   demos/previews/fontes e ausência de serviços DB públicos. Certificado válido
   e container saudável não significam backend ou autenticação prontos.

Se falhar a emissão, preserve o volume e diagnostique DNS/CAA/conectividade;
não reinstale para provocar novas solicitações repetidas e rate limit da CA.
Rollback é repor a tag/configuração anterior e executar up, sem apagar volumes.

## Backend real ainda bloqueado

A VPS não possui identidade Azure implícita. A API/provisioner exigem projeto de
identidade gerenciada e Key Vault versionado, bancos e Blob com acesso autorizado,
roles separados e custódia exclusiva do provisioner. Não copiar a chave local
mfa.key, credenciais de tenants, usuários, sessões, passkeys ou ERP para servir de
atalho; não habilitar APP_ENV=development publicamente. Eventuais recursos Azure
pagos e mudanças na arquitetura exigem configuração/decisão própria, não esta
imagem web. Bootstrap/recovery do administrador existente continua proibido.

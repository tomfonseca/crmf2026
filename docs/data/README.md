# Evidências ERP — somente no ambiente autorizado

Este repositório público contém código, contratos, fixtures sintéticas e
documentação de arquitetura. Os dumps, o schema extraído e os relatórios com
dados reais do ERP ficam fora do Git e não são entradas de CI nem de builds.

Para trabalhar nas telas do colaborador, regras de indicadores, CMV, metas,
acesso a lojas ou extração Linx Big, consulte primeiro os artefatos privados
no ambiente autorizado:

- `crmf-mapeamento-dados-telas.md`: hipóteses e perguntas de mapeamento.
- `crmf-mapeamento-validado.md`: evidências e limites da validação.
- `docs/data/mapeamento-telas.md`: índice local e relatórios de conferência.
- `schema_relacionamentos.txt`: metadata e relações inferidas, não FKs provadas.

Esses arquivos são intencionalmente ignorados. Em um clone novo, obtenha acesso
local autorizado antes de implementar regras dependentes dessas evidências;
não publique os arquivos para resolver referências ausentes. Nunca substitua
dados indisponíveis por números inventados.

O conector e o carregamento analítico de produção ainda não estão completos.
A prévia do dashboard usa dados sintéticos e não é uma integração com o ERP.

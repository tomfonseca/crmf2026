import { Panel } from "@crmf/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`qg-pill ${tone}`}>{children}</span>;
}
export function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Panel title={title} className="qg-card">
      {children}
    </Panel>
  );
}
export function GridTable({
  title,
  columns,
  rows = [],
}: {
  title: string;
  columns: readonly string[];
  rows?: readonly (readonly ReactNode[])[];
}) {
  return (
    <div className="hq-table-wrap">
      <table aria-label={title} data-columns={columns.length}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th scope="col" key={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) =>
                  j === 0 ? (
                    <th scope="row" key={j}>
                      {v}
                    </th>
                  ) : (
                    <td key={j}>{v}</td>
                  ),
                )}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>
                Informações indisponíveis — integração prevista. Ausência de
                dados não significa zero.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Fields({ labels }: { labels: string[] }) {
  return (
    <div className="hq-form-grid">
      {labels.map((label) => (
        <label key={label}>
          {label}
          <input disabled placeholder="Previsto" />
        </label>
      ))}
    </div>
  );
}
function Info({ labels, demo }: { labels: string[]; demo: boolean }) {
  return (
    <dl className="qg-info">
      {labels.map((l, i) => (
        <div key={l}>
          <dt>{l}</dt>
          <dd>
            {demo
              ? ["Exemplo visual", "25/11/2026 · 12:41", "—"][i % 3]
              : "Não disponibilizado"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function QGDialog({
  title,
  destructive = false,
  onClose,
  children,
}: {
  title: string;
  destructive?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
    return () => {
      dialog?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      role={destructive ? "alertdialog" : "dialog"}
      aria-labelledby="qg-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="qg-dialog-title">{title}</h2>
        <button aria-label="Fechar diálogo" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function OperationalScreen({
  family,
  variant = "",
  title,
  support = false,
  preview = false,
  navigate,
}: {
  family: string;
  variant?: string;
  title?: string;
  support?: boolean;
  preview?: boolean;
  navigate: (path: string) => void;
}) {
  const [tab, setTab] = useState(() =>
      variant.startsWith("aba-")
        ? variant.slice(4)
        : (new URLSearchParams(window.location.search).get("aba") ?? "dados"),
    ),
    [dialog, setDialog] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const demo = preview,
    value = (example: string) => (demo ? example : "—");
  const labels: Record<string, string> = {
    overview: "Painel operacional",
    stores: "Lojas",
    store: "Loja",
    storeForm: "Cadastrar loja",
    pairing: "Parear dispositivo",
    reinstall: "Loja",
    devices: "Dispositivos",
    device: "Dispositivo",
    batches: "Monitor de envios",
    batch: "Lote",
    network: "Rede",
    setup: "Preparação da rede",
    networkAction: "Rede",
    planForm: "Editar plano",
    planConflict: "Editar plano",
    planDelete: "Planos",
    plans: "Planos",
    networks: "Redes",
    networkForm: "Cadastrar rede",
    releases: "Releases",
    connectors: "Conectores",
    users: "Usuários internos",
    audit: "Auditoria",
  };
  const dialogs: Record<string, string> = {
    revogar: "Revogar dispositivo",
    reconciliacao: "Reconciliar período",
    "trilha-fria": "Executar trilha fria",
    "versao-alvo": "Definir versão-alvo",
    suspender: "Suspender rede",
    reativar: "Reativar rede",
    cancelar: "Cancelar rede",
    reinstalar: "Reinstalar o agente da loja",
    excluir: "Excluir plano",
  };
  const initialDialog =
    family === "reinstall"
      ? "reinstalar"
      : family === "networkAction"
        ? variant.includes("reativar")
          ? "reativar"
          : variant.includes("cancelar")
            ? "cancelar"
            : "suspender"
        : family === "planDelete"
          ? "excluir"
          : variant.startsWith("dialogo-")
            ? variant.slice(8)
            : "";
  const activeDialog = dialog || initialDialog;
  const [dismissed, setDismissed] = useState(false);
  const empty = /vazio|sem-resultado|busca-sem-resultado|sem-dados/.test(
      variant,
    ),
    loading = /carregando/.test(variant),
    error = variant === "erro";
  const sampleRows = (rows: ReactNode[][]) => (demo && !empty ? rows : []);
  function action(label: string, key?: string) {
    return (
      <button
        key={label}
        disabled={
          !preview ||
          !key ||
          (support &&
            [
              "revogar",
              "versao-alvo",
              "excluir",
              "suspender",
              "reativar",
              "cancelar",
            ].includes(key ?? ""))
        }
        onClick={() => key && (setDismissed(false), setDialog(key))}
      >
        {label}
        {!preview ? " · Previsto" : ""}
      </button>
    );
  }
  function table(name: string, columns: string[], rows: ReactNode[][] = []) {
    return <GridTable title={name} columns={columns} rows={sampleRows(rows)} />;
  }
  function tabs(names: string[]) {
    return (
      <nav className="qg-tabs" aria-label="Seções da rede">
        {names.map((n) => (
          <button
            key={n}
            aria-current={tab === n ? "page" : undefined}
            onClick={() => {
              setTab(n);
              if (!preview) navigate(window.location.pathname + "?aba=" + n);
            }}
          >
            {
              (
                {
                  dados: "Dados",
                  assinatura: "Assinatura",
                  lojas: "Lojas",
                  usuarios: "Usuários",
                  cobranca: "Cobrança",
                } as Record<string, string>
              )[n]
            }
          </button>
        ))}
      </nav>
    );
  }
  const storeRows = [
    [
      "Loja de exemplo · 101",
      "Rede de exemplo",
      "Cidade · UF",
      "Linx Big",
      <Pill tone="ok">Saudável</Pill>,
      "Aguardando pareamento",
      "25/11 · 12:41",
    ],
  ];
  return (
    <section className="qg-operational">
      <header className="qg-page-heading">
        <p className="hq-eyebrow">QG / {labels[family] ?? "Operação"}</p>
        <h1 tabIndex={-1}>
          {title ?? labels[family] ?? "Página não encontrada"}
        </h1>
        <p className="hq-muted">
          {preview
            ? "Dados sintéticos · prévia visual, sem operações reais."
            : "Operação prevista — esta tela ainda não possui integração operacional."}
        </p>
      </header>
      {!preview && (
        <div className="qg-banner" role="status">
          <Pill>Previsto</Pill> Esta interface não consulta o ERP, não envia
          comandos e não altera dados. Os recursos serão liberados após
          implementação e autorização dos serviços correspondentes.
        </div>
      )}
      {support && (
        <p className="qg-banner">Acesso de suporte: somente leitura.</p>
      )}
      {error ? (
        <div role="alert" className="qg-banner danger">
          Não foi possível carregar os dados. Nenhum indicador foi convertido em
          zero. <button disabled={!preview}>Tentar novamente</button>
        </div>
      ) : loading ? (
        <div className="qg-card qg-skeleton" role="status">
          Carregando…
          {[1, 2, 3, 4].map((i) => (
            <span key={i} />
          ))}
        </div>
      ) : (
        <>
          {variant === "desatualizado" && (
            <p className="qg-banner warn">
              Os agregados estão desatualizados. Exemplo visual; limiar
              operacional ainda não aprovado.
            </p>
          )}
          {family === "overview" && (
            <>
              <div className="qg-kpis">
                {[
                  "Redes ativas",
                  "Lojas",
                  "Dispositivos",
                  "Lotes falhos (24 h)",
                ].map((l, i) => (
                  <article className="qg-card" key={l}>
                    <span>{l}</span>
                    <strong>
                      {empty ? "—" : value(["3", "20", "44", "5"][i])}
                    </strong>
                    <small>
                      {preview && !empty
                        ? "Dados de exemplo"
                        : "Sem dados operacionais"}
                    </small>
                  </article>
                ))}
              </div>
              <div className="qg-two">
                <Card title="Alertas">
                  {demo && !empty ? (
                    <ul className="qg-alerts">
                      {[
                        "Lotes com falha",
                        "Dispositivo offline",
                        "Assinatura em atraso",
                        "Preparação pendente",
                      ].map((s, i) => (
                        <li key={s}>
                          <Pill tone={i < 2 ? "danger" : "warn"}>
                            {i < 2 ? "Crítico" : "Atenção"}
                          </Pill>
                          <span>{s}</span>
                          <button
                            onClick={() =>
                              navigate(
                                [
                                  "/batches",
                                  "/devices",
                                  "/tenants",
                                  "/tenants",
                                ][i],
                              )
                            }
                          >
                            Ver detalhes
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      Alertas indisponíveis. Nenhum estado saudável foi
                      presumido.
                    </p>
                  )}
                </Card>
                <Card title="Saúde dos dispositivos">
                  {demo && !empty && (
                    <div className="qg-health-bar" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </div>
                  )}
                  {table(
                    "Dispositivos por saúde",
                    ["Saúde", "Dispositivos"],
                    [
                      ["Saudável", "38"],
                      ["Atrasado", "3"],
                      ["Offline", "1"],
                      ["Versão desatualizada", "2"],
                    ],
                  )}
                </Card>
              </div>
              <Card title="Faturamento agregado por rede">
                {table(
                  "Faturamento agregado por rede",
                  [
                    "Rede",
                    "Lojas",
                    "Faturamento líquido (mês)",
                    "Variação",
                    "Dados",
                  ],
                  [
                    [
                      "Rede de exemplo",
                      "3",
                      "R$ 412.380,00",
                      "▲ 4,1%",
                      "Exemplo sintético",
                    ],
                  ],
                )}
                <p>
                  Agregados por rede e dia; nunca vendas individuais nem
                  clientes. Sem base não é zero.
                </p>
              </Card>
            </>
          )}
          {["stores", "devices", "batches", "plans", "networks"].includes(
            family,
          ) && (
            <>
              <div className="qg-filters">
                <label>
                  Buscar {labels[family]?.toLowerCase()}
                  <input placeholder="Buscar nesta tela" disabled={!preview} />
                </label>
                {[
                  "Rede",
                  family === "devices" ? "Saúde" : "Situação",
                  family === "batches" ? "Fluxo" : "Plano",
                ].map((l) => (
                  <label key={l}>
                    {l}
                    <select disabled={!preview}>
                      <option>Todos</option>
                    </select>
                  </label>
                ))}
                {!support &&
                  action(
                    family === "stores"
                      ? "Cadastrar loja"
                      : family === "plans"
                        ? "Cadastrar plano"
                        : "Atualizar",
                  )}
              </div>
              {family === "batches" && (
                <Card title="Linha do tempo (24 h)">
                  <div className="qg-timeline" aria-hidden="true">
                    {["Loja exemplo A", "Loja exemplo B"].map((l) => (
                      <div key={l}>
                        <span>{l}</span>
                        {Array.from({ length: 24 }, (_, i) => (
                          <i
                            key={i}
                            title={`${l} · ${i}h · ${demo ? "processado (exemplo)" : "sem informação"}`}
                            className={
                              demo ? (i % 7 === 0 ? "warn" : "ok") : ""
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary>Ver como tabela</summary>
                    {table(
                      "Linha do tempo acessível",
                      ["Loja", "Hora", "Situação"],
                      [["Loja exemplo A", "12h", "Processado (exemplo)"]],
                    )}
                  </details>
                </Card>
              )}
              {family === "stores"
                ? table(
                    "Lojas",
                    [
                      "Loja",
                      "Rede",
                      "Cidade/UF",
                      "ERP",
                      "Dados",
                      "Agente",
                      "Última atualização",
                    ],
                    storeRows,
                  )
                : family === "devices"
                  ? table(
                      "Dispositivos",
                      [
                        "Dispositivo",
                        "Loja · rede",
                        "Saúde",
                        "Último heartbeat",
                        "Agente · updater · conector",
                        "Arquitetura",
                        "Spool · disco",
                      ],
                      [
                        [
                          "DEV-EXEMPLO",
                          "Loja exemplo · Rede exemplo",
                          "Saudável",
                          "12:41",
                          "0.1 · 0.1 · v1",
                          "amd64",
                          "184 MB · 12 GB",
                        ],
                      ],
                    )
                  : family === "batches"
                    ? table(
                        "Lotes",
                        [
                          "Lote",
                          "Loja",
                          "Fluxo",
                          "Janela de dados",
                          "Tamanho",
                          "Situação",
                          "Atualizado",
                        ],
                        [
                          [
                            "#20491",
                            "Loja exemplo",
                            "vendas",
                            "25/11 · 12h–13h",
                            "184 KB · 1.204 linhas",
                            "Processado",
                            "12:41",
                          ],
                        ],
                      )
                    : family === "plans"
                      ? table(
                          "Planos",
                          [
                            "Plano",
                            "Preço",
                            "Sincronização",
                            "Histórico",
                            "Limites",
                            "Módulos",
                            "Situação",
                            "Assinaturas",
                          ],
                          [
                            [
                              "Plano exemplo",
                              "R$ [preço]",
                              "3 min",
                              "12 meses",
                              "5 lojas · 20 usuários",
                              "core",
                              "Ativo",
                              "2 redes",
                            ],
                          ],
                        )
                      : table(
                          "Redes",
                          [
                            "Rede",
                            "Plano",
                            "Assinatura",
                            "Lojas",
                            "Dispositivos",
                            "Preparação",
                            "Criada em",
                          ],
                          [
                            [
                              "Rede de exemplo",
                              "Plano exemplo",
                              "Ativa",
                              "3 de 5",
                              "Saudável · 3",
                              "Concluída",
                              "25/11/2026",
                            ],
                          ],
                        )}
            </>
          )}
          {["storeForm", "networkForm", "planForm", "planConflict"].includes(
            family,
          ) && (
            <div className="qg-form-page">
              {family === "storeForm" ? (
                <>
                  <Card title="Identificação">
                    <Fields labels={["Rede", "Código da loja *", "Nome *"]} />
                  </Card>
                  <Card title="Localização">
                    <Fields labels={["Cidade", "UF", "Fuso horário"]} />
                  </Card>
                  <Card title="Integração">
                    <Fields labels={["ERP · Linx Big", "Situação"]} />
                  </Card>
                  {variant === "limite-atingido" && (
                    <p className="qg-banner warn">
                      Limite de lojas atingido (exemplo). O salvamento exige
                      verificação transacional do plano.
                    </p>
                  )}
                </>
              ) : family === "networkForm" ? (
                <>
                  <Card title="Identificação">
                    <Fields labels={["Nome da rede *", "Identificador *"]} />
                  </Card>
                  <Card title="Dados cadastrais">
                    <Fields labels={["Razão social", "CNPJ", "Cidade", "UF"]} />
                  </Card>
                  <Card title="Contato comercial">
                    <p>Não é o administrador da rede.</p>
                    <Fields labels={["Nome do contato", "E-mail do contato"]} />
                  </Card>
                  <Card title="Assinatura">
                    <Fields
                      labels={[
                        "Plano *",
                        "Fuso horário padrão das lojas",
                        "Identificador de cobrança",
                      ]}
                    />
                  </Card>
                </>
              ) : (
                <>
                  <Card title="Identificação">
                    <Fields
                      labels={["Código · imutável em edição", "Nome *"]}
                    />
                  </Card>
                  <Card title="Preço e dados">
                    <Fields
                      labels={[
                        "Preço mensal (R$)",
                        "Intervalo de sincronização (minutos)",
                        "Histórico disponível (meses)",
                      ]}
                    />
                  </Card>
                  <Card title="Limites">
                    <Fields
                      labels={["Máximo de lojas", "Máximo de usuários"]}
                    />
                  </Card>
                  <Card title="Módulos">
                    {[
                      "core",
                      "realtime",
                      "export",
                      "pulse · Previsto, fase 2",
                    ].map((l) => (
                      <label className="hq-check" key={l}>
                        <input type="checkbox" disabled />
                        {l}
                      </label>
                    ))}
                  </Card>
                  <Card title="Situação">
                    <label>
                      <input type="checkbox" disabled /> Plano ativo
                    </label>
                  </Card>
                </>
              )}
              {/validacao|duplicado/.test(variant) && (
                <p className="qg-banner danger" role="alert">
                  Revise os campos obrigatórios. Identificadores não podem ser
                  reutilizados.
                </p>
              )}
              {family === "planConflict" && (
                <Card title="Este plano foi alterado por outra pessoa">
                  <p>
                    Não sobrescrever. Autor e revisão devem vir da API, nunca
                    ser presumidos.
                  </p>
                  {table(
                    "Comparação de revisão",
                    ["Campo", "Sua alteração", "Versão atual (salva)"],
                    [["Preço mensal", "R$ [novo preço]", "R$ [preço salvo]"]],
                  )}
                  {action("Recarregar versão atual")}
                  {action("Copiar minhas alterações")}
                </Card>
              )}
              <div className="hq-actions">
                {action(/salvando/.test(variant) ? "Salvando…" : "Salvar")}
                {action("Cancelar")}
              </div>
            </div>
          )}
          {["network", "networkAction"].includes(family) && (
            <>
              {tabs(["dados", "assinatura", "lojas", "usuarios", "cobranca"])}
              {tab === "dados" ? (
                <Card title="Dados cadastrais">
                  <Info
                    demo={demo}
                    labels={[
                      "Rede",
                      "Identificador · Imutável",
                      "CNPJ",
                      "Cidade/UF",
                      "Contato comercial",
                    ]}
                  />
                  {!support && action("Editar")}
                </Card>
              ) : tab === "assinatura" ? (
                <>
                  <Card title="Assinatura">
                    <Info
                      demo={demo}
                      labels={[
                        "Plano",
                        "Situação",
                        "Início",
                        "Próximo ciclo",
                        "Tolerância",
                        "ID de cobrança",
                      ]}
                    />
                    {!support && action("Trocar plano")}
                    <p>O QG não faz cobrança nem coleta pagamento.</p>
                  </Card>
                  <Card title="Limites e módulos efetivos">
                    {table(
                      "Limites efetivos",
                      [
                        "Recurso",
                        "No plano",
                        "Ajuste da assinatura",
                        "Efetivo",
                        "Origem",
                      ],
                      [["Lojas", "5", "—", "5", "Herdado"]],
                    )}
                    {!support && action("Editar ajustes")}
                  </Card>
                  <Card title="Histórico da assinatura">
                    {table("Histórico da assinatura", [
                      "Data",
                      "Plano",
                      "Situação",
                      "Origem",
                    ])}
                  </Card>
                </>
              ) : tab === "lojas" ? (
                <Card title="Lojas da rede">
                  {table(
                    "Lojas da rede",
                    ["Loja", "Código", "Situação"],
                    [["Loja exemplo", "101", "Ativa"]],
                  )}
                  {!support && action("Cadastrar loja")}
                </Card>
              ) : tab === "usuarios" ? (
                <Card title="Primeiro administrador">
                  <p>
                    Convite de 72 h ·{" "}
                    {value(
                      variant.includes("aceito")
                        ? "Aceito"
                        : variant.includes("expirado")
                          ? "Expirado"
                          : variant.includes("reenviado")
                            ? "Reenviado"
                            : "Pendente",
                    )}
                  </p>
                  {!support && (
                    <>
                      {action("Reenviar convite")}
                      {action("Cancelar convite")}
                    </>
                  )}
                  <p>
                    O QG convida apenas o primeiro administrador. Não há
                    impersonação.
                  </p>
                </Card>
              ) : (
                <Card title="Eventos de cobrança">
                  {table("Eventos de cobrança", [
                    "Data",
                    "Tipo",
                    "Origem",
                    "ID do evento",
                    "Efeito",
                  ])}
                </Card>
              )}
              {!support && (
                <div className="hq-actions">
                  {action("Suspender rede", "suspender")}
                  {action("Reativar rede", "reativar")}
                  {action("Cancelar rede", "cancelar")}
                </div>
              )}
            </>
          )}
          {family === "setup" && (
            <Card title="Preparação do ambiente">
              <Info
                demo={demo}
                labels={["Rede", "Identificador", "Início", "Tentativa"]}
              />
              <ol className="qg-steps" role="status" aria-live="polite">
                {[
                  "Cadastro salvo",
                  "Criar schema e permissões",
                  "Aplicar migrações",
                  "Criar assinatura",
                  "Liberar convites",
                ].map((s, i) => (
                  <li key={s}>
                    <strong>{s}</strong>
                    <Pill tone={demo && i < 2 ? "ok" : "neutral"}>
                      {demo
                        ? variant === "concluido" && i < 4
                          ? "Concluído"
                          : i < 2
                            ? "Concluído"
                            : variant === "falhou" && i === 2
                              ? "Falhou"
                              : "Aguardando"
                        : "Sem informação por etapa"}
                    </Pill>
                  </li>
                ))}
              </ol>
              <p>
                A preparação aceita pelo servidor continua se você sair. As
                etapas reais disponíveis serão exibidas sem inferir progresso
                pelo tempo.
              </p>
              {!support &&
                action(
                  variant === "concluido"
                    ? "Convidar administrador"
                    : "Tentar novamente",
                )}
            </Card>
          )}
          {["store", "reinstall"].includes(family) && (
            <>
              <p className="qg-banner">
                {value(
                  variant === "situacao-offline"
                    ? "Offline"
                    : variant === "situacao-sem-vendas"
                      ? "Sem vendas · integração ok"
                      : variant === "situacao-atrasado"
                        ? "Atrasado"
                        : variant === "situacao-sem-dados"
                          ? "Sem dados recebidos"
                          : "Saudável",
                )}{" "}
                · Dados de saúde dependem de heartbeat e lotes, não da ausência
                de vendas.
              </p>
              <div className="qg-two">
                <Card title="Dados da loja">
                  <Info
                    demo={demo}
                    labels={[
                      "Rede",
                      "Código no ERP",
                      "Nome",
                      "Cidade/UF",
                      "Fuso horário",
                      "ERP",
                      "Situação",
                    ]}
                  />
                  {!support && action("Editar")}
                </Card>
                <Card title="Agente">
                  <Info
                    demo={demo}
                    labels={[
                      "Dispositivo",
                      "Sistema",
                      "Versões",
                      "Pareado em",
                      "Último heartbeat",
                      "Último lote",
                    ]}
                  />
                  {!support && (
                    <>
                      {action("Gerar código de pareamento")}
                      {action("Reinstalar agente", "reinstalar")}
                    </>
                  )}
                </Card>
              </div>
              <Card title="Últimos lotes">
                {table(
                  "Últimos lotes da loja",
                  ["Lote", "Fluxo", "Janela de dados", "Situação"],
                  [["#20491", "vendas", "25/11 · 12h", "Processado"]],
                )}
              </Card>
            </>
          )}
          {family === "pairing" && (
            <div className="qg-two">
              <Card title="Código de pareamento">
                <p>Uso único · validade de 72 horas.</p>
                <p className="qg-pair-code">
                  {demo && !/usado|expirado/.test(variant) ? "DEMO-0000" : "—"}
                </p>
                <p className="qg-banner warn">
                  O código real aparecerá uma única vez. Este exemplo não pode
                  ser utilizado para parear dispositivos.
                </p>
                {!support &&
                  action(
                    variant === "expirado"
                      ? "Gerar novo código"
                      : "Copiar código",
                  )}
                {/usado|expirado/.test(variant) && (
                  <Pill>
                    {variant === "usado"
                      ? "Dispositivo pareado (exemplo)"
                      : "Código expirado (exemplo)"}
                  </Pill>
                )}
              </Card>
              <Card title="Instruções de instalação">
                <ol>
                  <li>Baixe o instalador publicado e assinado.</li>
                  <li>Execute no servidor da loja.</li>
                  <li>Informe o código de uso único na instalação.</li>
                  <li>Configure localmente o acesso de leitura ao ERP.</li>
                </ol>
                <pre>msiexec /i crmf-agent.msi</pre>
                {action("Baixar MSI")}
                <p>
                  Instalador ainda não publicado. Credenciais do banco ficam
                  exclusivamente no servidor da loja; nunca são exibidas no QG.
                </p>
              </Card>
            </div>
          )}
          {family === "device" && (
            <>
              <p className="qg-banner">
                {value(
                  variant.includes("offline")
                    ? "Offline"
                    : variant.includes("espaco")
                      ? "Pouco espaço em disco"
                      : variant.includes("erros")
                        ? "Fluxo com erro"
                        : "Saudável",
                )}{" "}
                · Estado informado pelo agente.
              </p>
              <div className="qg-two">
                <Card title="Dispositivo">
                  <Info
                    demo={demo}
                    labels={[
                      "Loja · rede",
                      "Último heartbeat",
                      "Último lote",
                      "Sistema",
                      "Agente · updater · conector",
                      "Versão-alvo",
                      "Pareado em",
                    ]}
                  />
                </Card>
                <Card title="Recursos locais">
                  <Info
                    demo={demo}
                    labels={[
                      "Banco local · leitura",
                      "Spool",
                      "Disco disponível",
                    ]}
                  />
                </Card>
              </div>
              <Card title="Últimos resultados por fluxo">
                {table(
                  "Resultados por fluxo",
                  [
                    "Fluxo",
                    "Última execução",
                    "Resultado",
                    "Erro (sanitizado)",
                  ],
                  [
                    ...["vendas", "cadastros", "custos", "trilha fria"].map(
                      (s) => [s, "12:41", "Processado", "—"],
                    ),
                  ],
                )}
              </Card>
              <Card title="Comandos">
                <div className="hq-actions">
                  {action("Solicitar diagnóstico", "diagnostico")}
                  {action("Reconciliar período", "reconciliacao")}
                  {action("Executar trilha fria", "trilha-fria")}
                  {!support && (
                    <>
                      {action("Definir versão-alvo", "versao-alvo")}
                      {action("Revogar", "revogar")}
                    </>
                  )}
                </div>
                <p>
                  Entregues no próximo heartbeat. Permissões de suporte ainda
                  dependem de decisão; nenhuma ação real está liberada.
                </p>
                {table(
                  "Comandos",
                  ["Comando", "Solicitado por", "Quando", "Situação"],
                  [
                    [
                      "Diagnóstico",
                      "Pessoa de exemplo",
                      "12:30",
                      variant === "comando-sem-confirmacao"
                        ? "Sem confirmação — não significa que não foi executado"
                        : variant.includes("confirmado")
                          ? "Confirmado"
                          : variant.includes("falhou")
                            ? "Falhou"
                            : "Aguardando próximo heartbeat",
                    ],
                  ],
                )}
              </Card>
            </>
          )}
          {family === "batch" && (
            <>
              <p
                className={
                  "qg-banner " +
                  (variant === "processado"
                    ? "ok"
                    : variant === "quarentena"
                      ? "warn"
                      : "danger")
                }
              >
                {value(
                  variant === "processado"
                    ? "Lote processado"
                    : variant === "reprocessando"
                      ? "Reprocessando…"
                      : variant === "quarentena"
                        ? "Em quarentena: versão do conector não ativa"
                        : "Falha sanitizada: schema_mismatch · referência EXEMPLO",
                )}{" "}
                · Nenhuma garantia de atomicidade é inferida sem resposta do
                processador.
              </p>
              <div className="hq-actions">
                {action("Reprocessar")}
                {variant === "quarentena" && (
                  <button onClick={() => navigate("/connectors")}>
                    Ver conectores
                  </button>
                )}
              </div>
              <div className="qg-two">
                <Card title="Lote">
                  <Info
                    demo={demo}
                    labels={[
                      "Loja",
                      "Dispositivo",
                      "Fluxo",
                      "Janela",
                      "Tamanho",
                      "Conector",
                      "Hash",
                    ]}
                  />
                </Card>
                <Card title="Etapas e tentativas">
                  <ol className="qg-steps">
                    {["Anunciado", "Enviado", "Processando", "Processado"].map(
                      (s) => (
                        <li key={s}>
                          {s} <Pill>{value("12:41 · exemplo")}</Pill>
                        </li>
                      ),
                    )}
                  </ol>
                </Card>
              </div>
              <Card title="Histórico de tentativas">
                {table(
                  "Histórico de tentativas",
                  ["Tentativa", "Início", "Duração", "Resultado"],
                  [["1", "12:41", "2 s", "Falhou (exemplo)"]],
                )}
              </Card>
            </>
          )}
        </>
      )}
      {activeDialog && !dismissed && (
        <QGDialog
          title={dialogs[activeDialog] ?? "Comando previsto"}
          destructive={["revogar", "cancelar", "suspender", "excluir"].includes(
            activeDialog,
          )}
          onClose={() => {
            setDismissed(true);
            setDialog("");
          }}
        >
          <p>
            {activeDialog === "reinstalar"
              ? "O dispositivo atual continua enviando até o novo parear; só então será revogado. O histórico é preservado."
              : activeDialog === "revogar"
                ? "A revogação exige serviço próprio e auditoria. O prazo de parada é de até 15 minutos; será necessário novo pareamento."
                : "Revise o alvo e as consequências. A ação exige autorização e auditoria no servidor."}
          </p>
          {activeDialog === "reconciliacao" ? (
            <Fields labels={["Período de", "Período até"]} />
          ) : (
            <label>
              Confirmação digitada
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          {["cancelar", "suspender", "reativar"].includes(activeDialog) && (
            <label>
              Motivo (registrado na auditoria)
              <textarea disabled={!preview} />
            </label>
          )}
          <p className="qg-banner warn">
            {preview
              ? "Prévia visual: nenhuma alteração será enviada."
              : "Previsto: operação indisponível."}
          </p>
          <footer>
            <button onClick={() => setDismissed(true)}>Fechar</button>
            <button disabled>Confirmar · Previsto</button>
          </footer>
        </QGDialog>
      )}
    </section>
  );
}
export function routeFamily(path: string) {
  const url = new URL(path, "http://localhost"),
    parts = url.pathname.split("/").filter(Boolean);
  const [root, id, action] = parts;
  if (root === "overview") return "overview";
  if (root === "stores")
    return !id
      ? "stores"
      : id === "new" || action === "edit"
        ? "storeForm"
        : action === "pairing"
          ? "pairing"
          : action === "reinstall"
            ? "reinstall"
            : "store";
  if (root === "devices") return id ? "device" : "devices";
  if (root === "batches") return id ? "batch" : "batches";
  if (root === "tenants") return action === "setup" ? "setup" : "network";
  return root ?? "overview";
}

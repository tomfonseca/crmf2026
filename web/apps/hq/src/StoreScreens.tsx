import { useEffect, useRef, useState, type ReactNode } from "react";
import { PlanIcon } from "./PlanPresentation";
import { storeMessage } from "./stores-client";
import "./stores.css";

export type StoreHealth = "ok" | "late" | "offline" | "no-sales" | "no-data";
export type StoreRecord = {
  id: string;
  code: string;
  name: string;
  networkId: string;
  networkName: string;
  networkSlug: string;
  city: string;
  uf: string;
  timezone: string;
  active: boolean;
  health?: StoreHealth;
  version?: number;
  lastUpdate?: string;
  agent?: null | {
    id: string;
    system: string;
    version: string;
    versions: string;
    pairedAt: string;
    heartbeat: string;
    lastBatch: string;
  };
  batches?: {
    id: string;
    flow: string;
    window: string;
    status: "Processado" | "Falhou" | "Em processamento";
  }[];
};
export type StoreNetwork = {
  id: string;
  name: string;
  slug: string;
  defaultTimezone?: string;
};
export type StoreDraft = {
  networkId: string;
  code: string;
  name: string;
  city: string;
  uf: string;
  timezone: string;
  active: boolean | null;
};
export type StoreScreenProps = {
  route: string;
  navigate: (path: string) => void;
  canWrite: boolean;
  records?: readonly StoreRecord[];
  state?: "unavailable" | "loaded" | "loading" | "error" | "empty";
  networks?: readonly StoreNetwork[];
  networkState?: "loading" | "error" | "ready" | "unavailable";
  moreNetworks?: ReactNode;
  onReloadNetworks?: () => void;
  title?: string;
  variant?: string;
  preview?: boolean;
  connected?: boolean;
  pagination?: ReactNode;
  onReloadStores?: () => void;
  onSave?: (
    input: StoreDraft,
    record: StoreRecord | undefined,
    signal: AbortSignal,
  ) => Promise<StoreRecord>;
  onSaved?: (record: StoreRecord) => void;
};
const healthLabels: Record<StoreHealth, string> = {
  ok: "Saudável",
  late: "Atrasado",
  offline: "Offline",
  "no-sales": "Sem vendas · integração ok",
  "no-data": "Sem dados recebidos",
};
const healthTones: Record<StoreHealth, string> = {
  ok: "ok",
  late: "warn",
  offline: "danger",
  "no-sales": "info",
  "no-data": "neutral",
};
const unavailable = "Não disponível";
export function StoreBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`stores-badge stores-${tone}`}>{children}</span>;
}
function Health({ health }: { health?: StoreHealth }) {
  if (!health) return <span title="Telemetria ainda indisponível">—</span>;
  return (
    <StoreBadge tone={healthTones[health]}>{healthLabels[health]}</StoreBadge>
  );
}
export function StoreCard({
  title,
  action,
  children,
  table = false,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  table?: boolean;
}) {
  return (
    <section className={`stores-card${table ? " stores-table-card" : ""}`}>
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      <div className="stores-card-body">{children}</div>
    </section>
  );
}
function Heading({
  title,
  trail = "CLIENTES",
  subtitle,
  action,
}: {
  title: string;
  trail?: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="plans-heading">
      <div>
        <div className="plans-breadcrumb">{trail}</div>
        <h1 id="stores-title" tabIndex={-1}>
          {title}
        </h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
function Values({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="stores-values">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function PlannedAction({
  children,
  icon,
}: {
  children: ReactNode;
  icon?: "edit" | "refresh";
}) {
  return (
    <button
      type="button"
      disabled
      title="Previsto · serviço ainda não disponibilizado"
    >
      {icon && <PlanIcon name={icon} />} {children}
    </button>
  );
}
function LocalLink({
  path,
  navigate,
  children,
}: {
  path: string;
  navigate: (path: string) => void;
  children: ReactNode;
}) {
  return (
    <a
      href={path}
      onClick={(event) => {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigate(path);
        }
      }}
    >
      {children}
    </a>
  );
}
function Notice({
  children,
  tone = "info",
  role,
}: {
  children: ReactNode;
  tone?: string;
  role?: "alert" | "status";
}) {
  return (
    <div className={`stores-banner stores-${tone}`} role={role}>
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d={
            tone === "ok"
              ? "M5 12l5 5l10 -10"
              : tone === "warn" || tone === "danger"
                ? "M12 9v4M12 16h.01M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"
                : "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 9h.01M11 12h1v4h1"
          }
        />
      </svg>
      <div>{children}</div>
    </div>
  );
}

export function StoreScreens(props: StoreScreenProps) {
  const {
    route,
    navigate,
    canWrite,
    records = [],
    state = "unavailable",
    variant = "",
    preview = false,
    connected = false,
  } = props;
  const path = route.split("?")[0];
  const isNew = path === "/stores/new";
  const edit = /^\/stores\/[^/]+\/edit$/.test(path);
  const list = path === "/stores";
  const record = records.find((r) => r.id === path.split("/")[2]);
  return (
    <section className="stores-page plans-page" aria-labelledby="stores-title">
      {!canWrite && (
        <Notice role="status">Acesso de suporte: somente leitura.</Notice>
      )}
      {isNew || edit ? (
        canWrite ? (
          <StoreEditor
            key={route + ":" + (record?.id ?? "unknown")}
            {...props}
            record={isNew && preview ? records[0] : record}
            edit={edit}
          />
        ) : (
          <>
            <Heading title={edit ? "Editar loja" : "Cadastrar loja"} />
            <Notice>
              Cadastro e edição não estão disponíveis para o suporte.
            </Notice>
          </>
        )
      ) : list ? (
        <StoreList {...props} records={records} state={state} />
      ) : (
        <>
          <Heading
            title={props.title ?? record?.name ?? "Loja"}
            trail={`CLIENTES › REDES › ${record?.networkSlug ?? "REDE NÃO CONFIRMADA"} › LOJAS`}
            subtitle={
              record
                ? record.networkName + " · Linx Big"
                : "Rede e integração não confirmadas"
            }
            action={
              connected && record ? (
                <button
                  onClick={() => navigate("/stores/" + record.id + "/pairing")}
                >
                  Códigos de pareamento
                </button>
              ) : (
                canWrite && (
                  <PlannedAction icon="refresh">
                    {record?.agent
                      ? "Reinstalar agente"
                      : "Gerar código de pareamento"}
                  </PlannedAction>
                )
              )
            }
          />
          {record?.health ? (
            <Notice tone={healthTones[record.health]}>
              <strong>{healthLabels[record.health]}.</strong>{" "}
              {record.agent
                ? `Último lote: ${record.agent.lastBatch} · heartbeat ${record.agent.heartbeat}.`
                : "Nenhum dispositivo pareado nesta prévia."}
            </Notice>
          ) : (
            <Notice>
              Saúde dos dados e do agente não disponível. A ausência de
              integração não confirma uma loja offline, sem vendas ou sem
              pareamento.
            </Notice>
          )}
          <div className="stores-grid stores-details-grid">
            <StoreCard
              title="Dados da loja"
              action={
                canWrite &&
                (record ? (
                  <button onClick={() => navigate(`/stores/${record.id}/edit`)}>
                    <PlanIcon name="edit" />
                    Editar
                  </button>
                ) : (
                  <PlannedAction icon="edit">Editar</PlannedAction>
                ))
              }
            >
              <Values
                items={[
                  ["Código", record ? <code>{record.code}</code> : unavailable],
                  [
                    "Rede",
                    record ? (
                      <LocalLink
                        path={`/tenants/${record.networkSlug}?aba=dados`}
                        navigate={navigate}
                      >
                        {record.networkName}
                      </LocalLink>
                    ) : (
                      unavailable
                    ),
                  ],
                  [
                    "Cidade/UF",
                    record
                      ? [record.city, record.uf].filter(Boolean).join("/") ||
                        unavailable
                      : unavailable,
                  ],
                  ["Fuso", record?.timezone ?? unavailable],
                  ["ERP", record ? "Linx Big" : unavailable],
                  [
                    "Situação",
                    record ? (
                      <StoreBadge tone={record.active ? "ok" : "neutral"}>
                        {record.active ? "Ativa" : "Inativa"}
                      </StoreBadge>
                    ) : (
                      unavailable
                    ),
                  ],
                ]}
              />
            </StoreCard>
            <StoreCard
              title="Agente"
              action={
                record?.agent && <PlannedAction>Ver dispositivo</PlannedAction>
              }
            >
              {record?.agent === null ? (
                <div className="stores-empty">
                  <h3>Nenhum dispositivo pareado</h3>
                  <p>O agente precisa ser instalado e pareado com esta loja.</p>
                  {canWrite && (
                    <PlannedAction>Gerar código de pareamento</PlannedAction>
                  )}
                </div>
              ) : (
                <Values
                  items={[
                    [
                      "Dispositivo",
                      record?.agent
                        ? `${record.agent.id} · ${record.agent.system}`
                        : unavailable,
                    ],
                    ["Versões", record?.agent?.versions ?? unavailable],
                    ["Pareado em", record?.agent?.pairedAt ?? unavailable],
                    [
                      "Último heartbeat",
                      record?.agent?.heartbeat ?? unavailable,
                    ],
                    ["Último lote", record?.agent?.lastBatch ?? unavailable],
                  ]}
                />
              )}
            </StoreCard>
          </div>
          <StoreCard
            title="Últimos lotes"
            table
            action={
              <LocalLink path="/batches" navigate={navigate}>
                Monitor de envios
              </LocalLink>
            }
          >
            <div className="stores-table-scroll">
              <table>
                <thead>
                  <tr>
                    {["Lote", "Fluxo", "Janela de dados", "Situação"].map(
                      (c) => (
                        <th scope="col" key={c}>
                          {c}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {record?.batches?.map((batch) => (
                    <tr key={batch.id}>
                      <th scope="row">{batch.id}</th>
                      <td>{batch.flow}</td>
                      <td>{batch.window}</td>
                      <td>
                        <StoreBadge
                          tone={
                            batch.status === "Processado"
                              ? "ok"
                              : batch.status === "Falhou"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {batch.status}
                        </StoreBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!record?.batches?.length && (
              <div className="stores-empty">
                {preview && record
                  ? "Nenhum lote nesta prévia visual."
                  : "Consulta de lotes ainda não disponível."}
              </div>
            )}
          </StoreCard>
          {!preview && (
            <Notice>
              {props.connected
                ? "Configuração consultada no controle. Dispositivos, pareamento, telemetria e lotes ainda não integrados."
                : "Previsto: consulta/edição da loja, dispositivos, pareamento e lotes ainda não integrados. Nenhum dado foi criado a partir deste endereço."}
            </Notice>
          )}
          {preview && variant === "situacao-sem-dados" && (
            <p className="stores-help">
              Prévia sem dispositivo: nenhum código de pareamento é gerado.
            </p>
          )}
        </>
      )}
    </section>
  );
}
function StoreList({
  records = [],
  state = "unavailable",
  canWrite,
  navigate,
  title,
  variant = "",
  preview = false,
  connected = false,
  pagination,
  onReloadStores,
}: StoreScreenProps) {
  const [search, setSearch] = useState(
    variant === "busca-sem-resultado" ? "busca sem correspondência" : "",
  );
  const [network, setNetwork] = useState("");
  const [health, setHealth] = useState("");
  const items = records.filter(
    (r) =>
      (r.code + " " + r.name + " " + r.city)
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")) &&
      (!network || r.networkId === network) &&
      (!health || r.health === health),
  );
  const columns = [
    "Loja",
    "Rede",
    "Cidade/UF",
    "ERP",
    "Dados",
    "Agente",
    "Última atualização",
  ];
  return (
    <>
      <Heading
        title={title ?? "Lojas"}
        subtitle="Lojas de todas as redes, com situação dos dados e do agente."
        action={
          canWrite && (
            <button
              className="plans-primary"
              onClick={() => navigate("/stores/new")}
            >
              <PlanIcon name="plus" />
              Cadastrar loja
            </button>
          )
        }
      />
      <div className="stores-filters">
        <label className="plans-search">
          <span className="auth-sr-only">
            Buscar por código, nome ou cidade
          </span>
          <PlanIcon name="search" />
          <input
            placeholder="Buscar por código, nome ou cidade"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={state === "unavailable"}
          />
        </label>
        <label>
          Rede
          <select
            disabled={state === "unavailable"}
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
          >
            <option value="">Todas</option>
            {Array.from(
              new Map(records.map((r) => [r.networkId, r.networkName])),
            ).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dados
          <select
            disabled={state === "unavailable" || connected}
            value={health}
            onChange={(e) => setHealth(e.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(healthLabels).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state === "error" && (
        <Notice tone="danger" role="alert">
          Não foi possível carregar as lojas.{" "}
          {onReloadStores ? (
            <button onClick={onReloadStores}>Tentar novamente</button>
          ) : (
            <PlannedAction>Tentar novamente</PlannedAction>
          )}
        </Notice>
      )}
      <div className="stores-table-panel">
        <div
          className="stores-table-scroll"
          role="region"
          aria-label="Tabela de lojas"
          tabIndex={0}
        >
          <table>
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
              {state === "loaded" &&
                items.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <LocalLink path={`/stores/${r.id}`} navigate={navigate}>
                        {r.name}
                      </LocalLink>
                      <small>{r.code}</small>
                    </th>
                    <td>{r.networkName}</td>
                    <td>{[r.city, r.uf].filter(Boolean).join("/") || "—"}</td>
                    <td>Linx Big</td>
                    <td>
                      <Health health={r.health} />
                    </td>
                    <td>
                      {r.agent ? (
                        "v" + r.agent.version
                      ) : r.agent === null ? (
                        <StoreBadge tone="warn">
                          Aguardando pareamento
                        </StoreBadge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{r.lastUpdate ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {state === "loading" && (
          <div className="stores-loading" role="status">
            <span>Carregando lojas…</span>
            {[1, 2, 3, 4].map((n) => (
              <div key={n} aria-hidden="true" />
            ))}
          </div>
        )}
        {state === "unavailable" && (
          <div className="stores-empty">
            <h2>Consulta de lojas ainda não disponível.</h2>
            <p>
              Previsto. Não é possível confirmar lojas cadastradas, saúde dos
              dados ou versões do agente.
            </p>
          </div>
        )}
        {(state === "empty" || (state === "loaded" && !items.length)) && (
          <div className="stores-empty">
            <h2>
              {records.length
                ? "Nenhuma loja encontrada"
                : "Nenhuma loja cadastrada"}
            </h2>
            <p>
              {records.length
                ? "Nenhuma loja corresponde à busca e aos filtros atuais."
                : "Cadastre uma loja para preparar a instalação do agente."}
            </p>
            {records.length > 0 && (
              <button
                onClick={() => {
                  setSearch("");
                  setNetwork("");
                  setHealth("");
                }}
              >
                Limpar busca e filtros
              </button>
            )}
          </div>
        )}
        <footer className="stores-table-footer">
          <span>
            {state === "loaded" || state === "empty"
              ? `${items.length} lojas · ${new Set(items.map((r) => r.networkId)).size} redes${connected ? " nesta página" : ""}`
              : "Contagens não disponíveis"}
          </span>
          <span>
            “Sem vendas” = dispositivo saudável, sem vendas no período.
            “Offline” = sem heartbeat há mais de 10 min.
          </span>
        </footer>
        {pagination}
      </div>
      {!preview && (
        <p className="stores-help">
          {connected
            ? "Cadastro e edição conectados. Busca e rede filtram esta página. Telemetria, dispositivos e última atualização permanecem indisponíveis; situação da loja é configuração, não saúde do agente."
            : "Cadastro, edição e consulta de lojas previstos. O formulário permite conferir o preenchimento, mas não salva dados."}
        </p>
      )}
    </>
  );
}
const states =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  );
const zones = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Rio_Branco",
  "America/Noronha",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Araguaina",
  "America/Maceio",
  "America/Santarem",
  "America/Eirunepe",
];
function StoreEditor({
  record,
  edit,
  networks = [],
  networkState = "unavailable",
  moreNetworks,
  onReloadNetworks,
  navigate,
  title,
  variant = "",
  preview = false,
  connected = false,
  onSave,
  onSaved,
}: StoreScreenProps & { record?: StoreRecord; edit: boolean }) {
  const original = useRef(record);
  const form = useRef<HTMLFormElement>(null),
    controller = useRef<AbortController | null>(null),
    submitting = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current?.abort();
  }, []);
  const initial = useRef({
    networkId: record?.networkId ?? "",
    code: record?.code ?? "",
    name: record?.name ?? "",
    city: record?.city ?? "",
    uf: record?.uf ?? "",
    timezone: record?.timezone ?? (edit ? "" : "America/Sao_Paulo"),
    active: record?.active ?? (edit ? null : true),
  });
  const [input, setInput] = useState(initial.current);
  const dirty = JSON.stringify(input) !== JSON.stringify(initial.current);
  const saving = pending || (preview && variant === "salvando");
  const unknown = edit && !record;
  useEffect(() => {
    if (preview) return;
    function warn(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, preview]);
  return (
    <>
      <Heading
        title={title ?? (edit ? "Editar loja" : "Cadastrar loja")}
        trail={`CLIENTES › REDES${record ? " › " + record.networkSlug : ""} › ${edit ? "LOJAS › EDITAR" : "NOVA LOJA"}`}
      />
      {unknown && (
        <Notice>
          Não foi possível carregar os dados desta loja. O endereço não confirma
          sua existência. Edição indisponível.
        </Notice>
      )}
      {preview && variant === "limite-atingido" && (
        <Notice tone="warn" role="alert">
          O limite de lojas do plano foi atingido nesta prévia. O salvamento
          exige verificação transacional do plano.{" "}
          <button
            type="button"
            onClick={() =>
              navigate(
                `/tenants/${record?.networkSlug ?? "synthetic"}?aba=assinatura`,
              )
            }
          >
            Ver assinatura
          </button>
        </Notice>
      )}
      {preview && variant === "validacao" && (
        <Notice tone="danger" role="alert">
          Revise os campos obrigatórios.{" "}
          <a href="#store-code">Informe o código da loja.</a>{" "}
          <a href="#store-name">Informe o nome.</a>
        </Notice>
      )}
      <form
        ref={form}
        className="stores-form"
        data-dirty={!preview && dirty}
        data-saving={!preview && saving}
        data-draft-label="nesta loja"
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            !onSave ||
            submitting.current ||
            unknown ||
            !controller.current ||
            input.active === null
          )
            return;
          const own = controller.current;
          submitting.current = true;
          setPending(true);
          setError("");
          if (form.current) form.current.dataset.saving = "true";
          try {
            const saved = await onSave(input, original.current, own.signal);
            if (own.signal.aborted) return;
            initial.current = { ...input };
            if (form.current) {
              form.current.dataset.dirty = "false";
              form.current.dataset.saving = "false";
            }
            onSaved?.(saved);
          } catch (e) {
            if (!own.signal.aborted) setError(storeMessage(e));
          } finally {
            submitting.current = false;
            if (!own.signal.aborted) {
              setPending(false);
              if (form.current) form.current.dataset.saving = "false";
            }
          }
        }}
      >
        <fieldset className="stores-fields" disabled={unknown || saving}>
          <div className="stores-grid stores-form-grid">
            <StoreCard title="Identificação">
              <label>
                Rede
                <select
                  aria-label="Rede"
                  required
                  value={input.networkId}
                  disabled={edit || networkState !== "ready"}
                  onChange={(e) =>
                    setInput((v) => ({
                      ...v,
                      networkId: e.target.value,
                      timezone:
                        networks.find((n) => n.id === e.target.value)
                          ?.defaultTimezone || v.timezone,
                    }))
                  }
                >
                  <option value="">
                    {networkState === "loading"
                      ? "Carregando redes…"
                      : "Selecione uma rede"}
                  </option>
                  {networks.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
                <small>A rede não pode ser trocada depois.</small>
              </label>
              {networkState === "error" && (
                <div role="alert">
                  Não foi possível carregar as redes.{" "}
                  <button type="button" onClick={onReloadNetworks}>
                    Tentar novamente
                  </button>
                </div>
              )}
              {moreNetworks}
              <label>
                Código da loja <span aria-hidden="true">*</span>
                <input
                  id="store-code"
                  maxLength={64}
                  aria-label="Código da loja"
                  required
                  value={input.code}
                  aria-invalid={
                    (preview && variant === "validacao") || undefined
                  }
                  onChange={(e) =>
                    setInput((v) => ({ ...v, code: e.target.value }))
                  }
                />
                <small>Código usado no ERP. Único dentro da rede.</small>
              </label>
              <label>
                Nome <span aria-hidden="true">*</span>
                <input
                  id="store-name"
                  maxLength={200}
                  aria-label="Nome"
                  required
                  value={input.name}
                  aria-invalid={
                    (preview && variant === "validacao") || undefined
                  }
                  onChange={(e) =>
                    setInput((v) => ({ ...v, name: e.target.value }))
                  }
                />
              </label>
            </StoreCard>
            <StoreCard title="Localização">
              <div className="stores-city">
                <label>
                  Cidade
                  <input
                    value={input.city}
                    onChange={(e) =>
                      setInput((v) => ({ ...v, city: e.target.value }))
                    }
                  />
                </label>
                <label>
                  UF
                  <select
                    aria-label="UF"
                    value={input.uf}
                    onChange={(e) =>
                      setInput((v) => ({ ...v, uf: e.target.value }))
                    }
                  >
                    <option value="">UF</option>
                    {states.map((uf) => (
                      <option key={uf}>{uf}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Fuso horário
                <select
                  aria-label="Fuso horário"
                  aria-describedby="store-timezone-help"
                  value={input.timezone}
                  onChange={(e) =>
                    setInput((v) => ({ ...v, timezone: e.target.value }))
                  }
                >
                  {unknown && <option value="">Não disponível</option>}
                  {Array.from(
                    new Set([
                      ...(input.timezone ? [input.timezone] : []),
                      ...zones,
                    ]),
                  ).map((z) => (
                    <option key={z} value={z}>
                      {z}
                      {z === "America/Sao_Paulo" ? " (Brasília)" : ""}
                    </option>
                  ))}
                </select>
                <small id="store-timezone-help">
                  Usado para fechar o dia e as horas de venda da loja.
                </small>
              </label>
            </StoreCard>
            <StoreCard title="Integração">
              <label>
                ERP
                <select value={unknown ? "" : "linxbig"} disabled>
                  {unknown && <option value="">Não disponível</option>}
                  <option value="linxbig">Linx Big</option>
                </select>
                <small>Na fase 1, só o Linx Big está previsto.</small>
              </label>
              <label>
                Situação
                <select
                  aria-label="Situação"
                  aria-describedby="store-status-help"
                  value={
                    input.active === null
                      ? ""
                      : input.active
                        ? "active"
                        : "inactive"
                  }
                  onChange={(e) =>
                    setInput((v) => ({
                      ...v,
                      active: e.target.value === "active",
                    }))
                  }
                >
                  {unknown && <option value="">Não disponível</option>}
                  <option value="active">Ativa</option>
                  <option value="inactive">Inativa</option>
                </select>
                <small id="store-status-help">
                  {preview
                    ? "Loja inativa não recebe novos lotes nem aparece no Dash."
                    : connected
                      ? "A situação é gravada no controle de acesso. Loja inativa continua contando no limite do plano. Coleta e ingestão ainda não estão implementadas."
                      : "Loja inativa não recebe novos lotes nem aparece no Dash. A aplicação dessa política depende dos serviços ainda previstos."}
                </small>
              </label>
            </StoreCard>
          </div>
        </fieldset>
        {!preview && !connected && (
          <Notice>
            Cadastro e edição previstos: não há serviço de salvamento de lojas
            conectado. O preenchimento fica só nesta tela e será perdido ao
            sair. Nenhum pareamento será gerado.
          </Notice>
        )}
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <footer className="stores-form-actions">
          <button
            type="button"
            onClick={() =>
              navigate(edit && record ? `/stores/${record.id}` : "/stores")
            }
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className="plans-primary"
            disabled={
              !onSave ||
              saving ||
              unknown ||
              !input.networkId ||
              input.active === null
            }
            title={
              !onSave
                ? "Previsto · salvamento ainda não disponibilizado"
                : undefined
            }
          >
            {saving ? "Salvando…" : "Salvar loja"}
          </button>
        </footer>
      </form>
    </>
  );
}

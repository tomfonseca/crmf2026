import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useScope } from "@crmf/auth";
import {
  PlanFailure,
  planMessage,
  type Plan,
  type PlanClient,
  type PlanInput,
} from "./plans-client";
import "./hq.css";
import { Networks } from "./Networks";
import type { NetworkClient } from "./networks-client";
import { Shell, type WorkspaceActions } from "./Shell";
import { useQGRoute } from "./routing";
import {
  OperationalScreen,
  routeFamily,
  Pill,
  QGDialog,
} from "./OperationalScreens";

type Editor = { kind: "create" } | { kind: "edit" | "delete"; plan: Plan };
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export function parseMinutes(value: string): number {
  const seconds = Number(value) * 60;
  const rounded = Math.round(seconds);
  if (
    !value.trim() ||
    !Number.isFinite(seconds) ||
    Math.abs(seconds - rounded) > 1e-7 ||
    rounded < 1 ||
    rounded > 2147483647
  )
    throw new Error("Intervalo inválido");
  return rounded;
}
export function parsePrice(value: string): number {
  const match = /^(0|[1-9]\d{0,7})(?:,(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Preço inválido");
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 2147483647)
    throw new Error("Preço inválido");
  return cents;
}
export function CatalogHost(props: {
  networks?: NetworkClient;
  client: PlanClient;
  onExpired: () => void;
  theme: string;
  toggleTheme: () => void;
  actions?: WorkspaceActions;
}) {
  const [path, navigate] = useQGRoute();
  const scope = useScope();
  const support = !scope.grants.some((g) => g.role === "platform_admin");
  // Authenticated mount owns its cache. Logout/expiry discards it, not just UI.
  const [queries] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
          mutations: { retry: false, gcTime: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queries}>
      <Shell
        path={path}
        navigate={navigate}
        support={support}
        theme={props.theme}
        toggleTheme={props.toggleTheme}
        actions={props.actions}
      >
        {path.startsWith("/tenants") &&
        !/\/tenants\/[^/]+/.test(path.replace("/tenants/new", "/tenants")) &&
        props.networks ? (
          <Networks
            client={props.networks}
            route={path}
            navigate={navigate}
            plans={props.client}
            onExpired={props.onExpired}
            onPlans={() => navigate("/plans")}
            theme={props.theme}
            toggleTheme={props.toggleTheme}
          />
        ) : path === "/" || path.startsWith("/plans") ? (
          <Plans {...props} route={path} navigate={navigate} />
        ) : (
          <OperationalScreen
            key={path}
            family={routeFamily(path)}
            support={support}
            navigate={navigate}
          />
        )}
      </Shell>
    </QueryClientProvider>
  );
}
function Plans({
  client,
  onExpired,
  route,
  navigate,
}: {
  route: string;
  navigate: (path: string) => void;
  client: PlanClient;
  onExpired: () => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const scope = useScope();
  const canWrite = scope.grants.some(
    (grant) => grant.role === "platform_admin",
  );
  const [after, setAfter] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState("");
  const cache = useQueryClient();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("Todos");
  const query = useQuery({
    queryKey: ["hq-plans", after],
    queryFn: ({ signal }) => client.list(after, signal),
  });
  useEffect(() => {
    if (query.error instanceof PlanFailure && query.error.status === 401)
      onExpired();
  }, [query.error, onExpired]);
  useEffect(() => {
    if (route === "/plans/new" && canWrite) setEditor({ kind: "create" });
    else if (/^\/plans\/[^/]+$/.test(route) && canWrite) {
      const plan = query.data?.items.find((p) => p.id === route.split("/")[2]);
      if (plan)
        setEditor((current) =>
          current?.kind === "edit" && current.plan.id === plan.id
            ? current
            : { kind: "edit", plan },
        );
    } else setEditor(null);
  }, [route, canWrite, query.data]);
  const filtered = query.data?.items.filter(
    (p) =>
      (p.name + " " + p.code)
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")) &&
      (filter === "Todos" || (filter === "Ativos") === p.active),
  );
  function done(message: string) {
    setEditor(null);
    setNotice(message);
    navigate("/plans");
    void cache.invalidateQueries({ queryKey: ["hq-plans"] });
  }
  return (
    <section className="hq-catalog" aria-labelledby="plans-title">
      <header className="hq-heading">
        <div>
          <p className="hq-eyebrow">CATÁLOGO / PLANOS</p>
          <h1 tabIndex={-1} id="plans-title">
            {editor
              ? editor.kind === "create"
                ? "Cadastrar plano"
                : editor.kind === "delete"
                  ? "Planos"
                  : "Editar plano"
              : "Planos"}
          </h1>
        </div>
      </header>
      <p>
        Planos definem preço, sincronização, histórico, limites e módulos das
        assinaturas.
      </p>

      {!canWrite && <p role="status">Acesso de suporte: somente leitura.</p>}
      {notice && <p role="status">{notice}</p>}
      {!editor && canWrite && (
        <button
          onClick={() => {
            setNotice("");
            navigate("/plans/new");
          }}
        >
          Cadastrar plano
        </button>
      )}
      {editor && canWrite && (
        <PlanEditor
          key={editor.kind === "create" ? "new" : editor.plan.id + editor.kind}
          editor={editor}
          client={client}
          onDone={done}
          onCancel={() => {
            setEditor(null);
            navigate("/plans");
          }}
          onExpired={onExpired}
        />
      )}
      {query.isPending && <p role="status">Carregando planos…</p>}
      {query.isError && (
        <div role="alert">
          <p>{planMessage(query.error)}</p>
          <button onClick={() => void query.refetch()}>Tentar novamente</button>
        </div>
      )}
      {(!editor || editor.kind === "delete") && (
        <div className="qg-filters">
          <label>
            Buscar planos
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="qg-segment" aria-label="Situação dos planos">
            {["Todos", "Ativos", "Desativados"].map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="qg-filter-note">
            Filtros nesta página de até 100 planos.
          </span>
        </div>
      )}
      {(!editor || editor.kind === "delete") &&
        !query.isError &&
        query.data && (
          <>
            {query.data.items.length === 0 ? (
              <p>Nenhum plano nesta página.</p>
            ) : (
              <div
                className="hq-table-wrap qg-plan-table"
                tabIndex={0}
                role="region"
                aria-label="Catálogo de planos"
              >
                <table>
                  <caption>
                    Limites e módulos por plano. Valores em reais.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Plano</th>
                      <th scope="col">Preço</th>
                      <th scope="col">Sincronização</th>
                      <th scope="col">Histórico</th>
                      <th scope="col">Limites</th>
                      <th scope="col">Módulos</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Assinaturas</th>
                      {canWrite && <th scope="col">Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered?.map((plan) => (
                      <tr key={plan.id}>
                        <th scope="row">
                          {plan.name}
                          <small>
                            {plan.code} · revisão {plan.version}
                          </small>
                        </th>
                        <td>{money.format(plan.price_cents / 100)}</td>
                        <td>
                          {(plan.sync_interval_seconds / 60).toLocaleString(
                            "pt-BR",
                            { maximumFractionDigits: 4 },
                          )}{" "}
                          min
                        </td>
                        <td>{plan.history_months} meses</td>
                        <td>
                          {plan.max_stores ?? "Ilimitadas"} lojas
                          <br />
                          {plan.max_users ?? "Ilimitados"} usuários
                        </td>
                        <td>
                          {plan.modules.map((m) => (
                            <Pill key={m} tone="plan">
                              {m}
                              {m === "pulse" ? " · fase 2" : ""}
                            </Pill>
                          ))}
                          {!plan.modules.length && "Nenhum"}
                        </td>
                        <td>
                          <Pill tone={plan.active ? "ok" : "neutral"}>
                            {plan.active ? "Ativo" : "Desativado"}
                          </Pill>
                        </td>
                        <td title="Contagem de assinaturas não disponibilizada pela API">
                          —
                        </td>
                        {canWrite && (
                          <td className="hq-actions">
                            <button
                              disabled={!!editor}
                              onClick={() => {
                                setNotice("");
                                navigate("/plans/" + plan.id);
                              }}
                              aria-label={`Editar ${plan.name}`}
                            >
                              Editar
                            </button>
                            <button
                              disabled={!!editor}
                              className="auth-secondary"
                              onClick={() => {
                                setNotice("");
                                setEditor({ kind: "delete", plan });
                              }}
                              aria-label={`Excluir ${plan.name}`}
                            >
                              Excluir
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="qg-plan-cards">
              {filtered?.map((plan) => (
                <article className="qg-card" key={plan.id}>
                  <strong>{plan.name}</strong>
                  <code>{plan.code}</code>
                  <p>
                    <Pill tone={plan.active ? "ok" : "neutral"}>
                      {plan.active ? "Ativo" : "Desativado"}
                    </Pill>
                  </p>
                  <p>
                    {money.format(plan.price_cents / 100)} ·{" "}
                    {plan.history_months} meses ·{" "}
                    {plan.sync_interval_seconds / 60} min
                  </p>
                  <p>
                    {plan.max_stores ?? "Ilimitadas"} lojas ·{" "}
                    {plan.max_users ?? "Ilimitados"} usuários
                  </p>
                  <p>{plan.modules.join(", ") || "Nenhum módulo"}</p>
                  {canWrite && (
                    <button
                      onClick={() => navigate("/plans/" + plan.id)}
                      aria-label={"Editar " + plan.name}
                    >
                      Editar
                    </button>
                  )}
                </article>
              ))}
            </div>
            {filtered?.length === 0 && query.data.items.length > 0 && (
              <p>Nenhum plano corresponde aos filtros nesta página.</p>
            )}
            <nav className="hq-actions" aria-label="Paginação dos planos">
              <button
                disabled={!history.length || !!editor || query.isFetching}
                onClick={() => {
                  setAfter(history[history.length - 1]);
                  setHistory(history.slice(0, -1));
                }}
              >
                Página anterior
              </button>
              <button
                disabled={
                  !query.data.next_cursor || !!editor || query.isFetching
                }
                onClick={() => {
                  setHistory([...history, after]);
                  setAfter(query.data.next_cursor ?? "");
                }}
              >
                Próxima página
              </button>
              <button
                disabled={!!editor || query.isFetching}
                onClick={() => void query.refetch()}
              >
                Atualizar lista
              </button>
            </nav>
          </>
        )}
    </section>
  );
}
function PlanEditor({
  editor,
  client,
  onDone,
  onCancel,
  onExpired,
}: {
  editor: Editor;
  client: PlanClient;
  onDone: (message: string) => void;
  onCancel: () => void;
  onExpired: () => void;
}) {
  const original = editor.kind === "create" ? undefined : editor.plan;
  const [validation, setValidation] = useState("");
  const [dirty, setDirty] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const [unlimitedStores, setUnlimitedStores] = useState(
      original?.max_stores == null,
    ),
    [unlimitedUsers, setUnlimitedUsers] = useState(original?.max_users == null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty && !submitting.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const controller = useRef(new AbortController());
  const heading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    controller.current = new AbortController();
    heading.current?.focus();
    const active = controller.current;
    return () => active.abort();
  }, []);
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      if (editor.kind === "delete") {
        await client.remove(
          editor.plan,
          String(form.get("confirmation") ?? "").toLowerCase(),
          controller.current.signal,
        );
        return;
      }
      const nullable = (key: string) => {
        const value = String(form.get(key) ?? "");
        return value === "" ? null : Number(value);
      };
      const details = {
        name: String(form.get("name") ?? ""),
        price_cents: parsePrice(String(form.get("price") ?? "")),
        active: form.has("active"),
        sync_interval_seconds:
          original &&
          String(form.get("sync")) ===
            String(original.sync_interval_seconds / 60)
            ? original.sync_interval_seconds
            : parseMinutes(String(form.get("sync"))),
        history_months: Number(form.get("history")),
        max_stores: nullable("stores"),
        max_users: nullable("users"),
        modules: form.getAll("module") as PlanInput["modules"], // Values come exclusively from the fixed module checkboxes below.
      };
      if (editor.kind === "create")
        await client.create(
          { ...details, code: String(form.get("code") ?? "") },
          controller.current.signal,
        );
      else
        await client.update(
          editor.plan.id,
          { ...details, version: editor.plan.version },
          controller.current.signal,
        );
    },
    onSuccess: () => {
      if (!controller.current.signal.aborted) {
        if (formRef.current) formRef.current.dataset.dirty = "false";
        setDirty(false);
        onDone(editor.kind === "delete" ? "Plano excluído." : "Plano salvo.");
      }
    },
    onError: (error) => {
      if (error instanceof PlanFailure && error.status === 401) onExpired();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    setValidation("");
    if (editor.kind !== "delete") {
      try {
        parsePrice(String(form.get("price") ?? ""));
        if (
          !original ||
          String(form.get("sync")) !==
            String(original.sync_interval_seconds / 60)
        )
          parseMinutes(String(form.get("sync")));
      } catch {
        setValidation(
          "Informe um preço em reais, como 29,90, dentro do limite permitido.",
        );
        return;
      }
    }
    submitting.current = true;
    mutation.mutate(form);
  }
  const content = (
    <section className="hq-editor" aria-labelledby="editor-title">
      <h3 ref={heading} tabIndex={-1} id="editor-title">
        {editor.kind === "create"
          ? "Cadastrar plano"
          : editor.kind === "edit"
            ? "Editar plano"
            : "Excluir plano"}
      </h3>
      {validation && <p role="alert">{validation}</p>}
      {mutation.isError && <p role="alert">{planMessage(mutation.error)}</p>}
      {mutation.error instanceof PlanFailure &&
        mutation.error.status === 409 &&
        editor.kind !== "create" && (
          <div className="qg-banner warn">
            <h2>
              {mutation.error.kind === "plan_in_use"
                ? "Não é possível excluir este plano"
                : "Este plano foi alterado"}
            </h2>
            <p>
              {mutation.error.kind === "plan_in_use"
                ? "Há assinaturas vinculadas, inclusive históricas. A contagem não está disponível neste contrato. Desative o plano pela edição."
                : "Nenhuma alteração foi sobrescrita. O autor e a revisão atual precisam ser consultados; não são presumidos."}
            </p>
            <button
              type="button"
              onClick={() => {
                setDirty(false);
                onDone(
                  "Lista atualizada. Abra o plano para revisar a versão atual.",
                );
              }}
            >
              Recarregar versão atual
            </button>
            <button
              type="button"
              onClick={() => {
                if (formRef.current)
                  void navigator.clipboard
                    ?.writeText(
                      JSON.stringify(
                        Array.from(new FormData(formRef.current).entries()),
                        null,
                        2,
                      ),
                    )
                    .then(
                      () => setValidation("Alterações copiadas."),
                      () => setValidation("Não foi possível copiar."),
                    );
              }}
            >
              Copiar minhas alterações
            </button>
          </div>
        )}
      <form
        ref={formRef}
        data-dirty={dirty}
        onChange={() => setDirty(true)}
        onSubmit={submit}
      >
        <fieldset disabled={mutation.isPending}>
          {editor.kind === "delete" ? (
            <>
              <p>
                Exclusão permanente de <strong>{original?.name}</strong>. Planos
                com assinaturas não podem ser excluídos; desative-os.
              </p>
              <label>
                Digite o código {original?.code} para confirmar
                <input
                  name="confirmation"
                  autoComplete="off"
                  required
                  maxLength={64}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <div className="hq-form-grid">
                <h2 className="qg-form-section">Identificação</h2>
                <label>
                  Código
                  <input
                    name="code"
                    required
                    pattern="[a-z0-9][a-z0-9_-]{0,63}"
                    maxLength={64}
                    readOnly={!!original}
                    defaultValue={original?.code}
                  />
                  <small>
                    Identificador imutável, em letras minúsculas, números, _ ou
                    -.
                  </small>
                </label>
                <label>
                  Nome
                  <input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={original?.name}
                  />
                </label>
                <h2 className="qg-form-section">Preço e dados</h2>
                <label>
                  Preço (R$)
                  <input
                    name="price"
                    required
                    inputMode="decimal"
                    placeholder="29,90"
                    maxLength={11}
                    defaultValue={
                      original
                        ? `${Math.floor(original.price_cents / 100)},${String(original.price_cents % 100).padStart(2, "0")}`
                        : ""
                    }
                  />
                </label>
                <label>
                  Intervalo de sincronização (minutos)
                  <input
                    name="sync"
                    type="number"
                    min={1 / 60}
                    max={2147483647 / 60}
                    step="any"
                    required
                    defaultValue={
                      original ? original.sync_interval_seconds / 60 : undefined
                    }
                  />
                </label>
                <label>
                  Histórico (meses)
                  <input
                    name="history"
                    type="number"
                    min={1}
                    max={2147483647}
                    step={1}
                    required
                    defaultValue={original?.history_months}
                  />
                </label>
                <h2 className="qg-form-section">Limites</h2>
                <label>
                  Máximo de lojas (vazio = ilimitado)
                  <input
                    name="stores"
                    type="number"
                    min={1}
                    max={2147483647}
                    step={1}
                    defaultValue={original?.max_stores ?? ""}
                    disabled={unlimitedStores}
                    required={!unlimitedStores}
                  />
                </label>
                <label className="hq-check">
                  <input
                    type="checkbox"
                    checked={unlimitedStores}
                    onChange={(e) => setUnlimitedStores(e.target.checked)}
                  />
                  Ilimitado — lojas
                </label>
                <label>
                  Máximo de usuários (vazio = ilimitado)
                  <input
                    name="users"
                    type="number"
                    min={1}
                    max={2147483647}
                    step={1}
                    defaultValue={original?.max_users ?? ""}
                    disabled={unlimitedUsers}
                    required={!unlimitedUsers}
                  />
                </label>
                <label className="hq-check">
                  <input
                    type="checkbox"
                    checked={unlimitedUsers}
                    onChange={(e) => setUnlimitedUsers(e.target.checked)}
                  />
                  Ilimitado — usuários
                </label>
              </div>
              <fieldset>
                <legend>Módulos liberados</legend>
                {(["core", "realtime", "export", "pulse"] as const).map(
                  (module) => (
                    <label className="hq-check" key={module}>
                      <input
                        name="module"
                        type="checkbox"
                        value={module}
                        disabled={module === "pulse"}
                        defaultChecked={original?.modules.includes(module)}
                      />
                      {module}
                      {module === "pulse" ? " (previsto para fase 2)" : ""}
                    </label>
                  ),
                )}
                {original?.modules.includes("pulse") && (
                  <input type="hidden" name="module" value="pulse" />
                )}
                <p>
                  Sem seleção, nenhum módulo é liberado. Pulse permanece
                  previsto para fase 2; valores existentes são preservados.
                </p>
              </fieldset>
              <h2 className="qg-form-section">Situação</h2>
              <label className="hq-check">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={original?.active ?? true}
                />
                Plano ativo
              </label>
              <p>
                Alterações afetam as assinaturas vinculadas. Desativar preserva
                as assinaturas existentes.
              </p>
            </>
          )}
          <div className="hq-actions">
            {dirty && <Pill tone="warn">Alterações não salvas</Pill>}
            <button
              type="submit"
              disabled={
                mutation.isPending ||
                (editor.kind === "delete" &&
                  confirmation.toLowerCase() !== original?.code)
              }
            >
              {mutation.isPending
                ? "Salvando…"
                : editor.kind === "delete"
                  ? "Confirmar exclusão"
                  : "Salvar plano"}
            </button>
            <button
              type="button"
              className="auth-secondary"
              disabled={mutation.isPending}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("Descartar alterações não salvas?")
                ) {
                  if (formRef.current) formRef.current.dataset.dirty = "false";
                  onCancel();
                }
              }}
            >
              Cancelar
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
  return editor.kind === "delete" ? (
    <QGDialog
      title={
        mutation.error instanceof PlanFailure &&
        mutation.error.kind === "plan_in_use"
          ? "Não é possível excluir este plano"
          : "Excluir plano"
      }
      destructive
      onClose={onCancel}
    >
      {content}
    </QGDialog>
  ) : (
    content
  );
}

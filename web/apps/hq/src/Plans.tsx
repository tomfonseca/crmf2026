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
import "./plans.css";
import {
  PlanFields,
  PlanIcon,
  PlanDialog,
  syncLabel,
} from "./PlanPresentation";
import { Networks } from "./Networks";
import type { NetworkClient } from "./networks-client";
import { Shell, type WorkspaceActions } from "./Shell";
import { useQGRoute } from "./routing";
import { OperationalScreen, routeFamily, Pill } from "./OperationalScreens";

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
  const [path, navigate, leave] = useQGRoute();
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
        actions={
          props.actions
            ? {
                ...props.actions,
                onAccount: () => leave.requestLeave(props.actions!.onAccount),
                onLogout: () => leave.requestLeave(props.actions!.onLogout),
              }
            : undefined
        }
      >
        {leave.dialog}
        {(path === "/tenants" || path.startsWith("/tenants/")) &&
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
  const scope = useScope(),
    canWrite = scope.grants.some((g) => g.role === "platform_admin");
  const [after, setAfter] = useState(""),
    [history, setHistory] = useState<string[]>([]),
    [editor, setEditor] = useState<Editor | null>(null),
    [deleting, setDeleting] = useState<Plan | null>(null),
    [notice, setNotice] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("Todos");
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["hq-plans", after],
    queryFn: ({ signal }) => client.list(after, signal),
  });
  useEffect(() => {
    if (query.error instanceof PlanFailure && query.error.status === 401)
      onExpired();
  }, [query.error, onExpired]);
  useEffect(() => {
    if (route === "/plans/new" && canWrite)
      setEditor((current) =>
        current?.kind === "create" ? current : { kind: "create" },
      );
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
    setDeleting(null);
    setEditor(null);
    setNotice(message);
    navigate("/plans");
    void cache.invalidateQueries({ queryKey: ["hq-plans"] });
  }
  const edit = (plan: Plan) => {
    setNotice("");
    navigate("/plans/" + plan.id);
  };
  const actions = (plan: Plan) => (
    <div className="plans-row-actions">
      <button onClick={() => edit(plan)} aria-label={"Editar " + plan.name}>
        <PlanIcon name="edit" />
        Editar
      </button>
      <button
        className="plans-trash"
        onClick={() => {
          setNotice("");
          setDeleting(plan);
        }}
        aria-label={"Excluir " + plan.name}
      >
        <PlanIcon name="trash" />
      </button>
    </div>
  );
  return (
    <section className="hq-catalog plans-page" aria-labelledby="plans-title">
      <header className="plans-heading">
        <div>
          <nav className="plans-breadcrumb" aria-label="Trilha">
            Catálogo › Planos
            {editor?.kind === "edit"
              ? " › " + editor.plan.code
              : editor?.kind === "create"
                ? " › Cadastrar"
                : ""}
          </nav>
          <h1 id="plans-title" tabIndex={-1}>
            {editor
              ? editor.kind === "create"
                ? "Cadastrar plano"
                : "Editar plano"
              : "Planos"}
          </h1>
          {!editor && (
            <p>
              Planos definem preço, sincronização, histórico, limites e módulos
              das assinaturas.
            </p>
          )}
        </div>
        {!editor && canWrite && (
          <button
            className="plans-primary"
            onClick={() => {
              setNotice("");
              navigate("/plans/new");
            }}
          >
            <PlanIcon name="plus" />
            Cadastrar plano
          </button>
        )}
      </header>
      {!canWrite && <p role="status">Acesso de suporte: somente leitura.</p>}
      {notice && <p role="status">{notice}</p>}
      {editor && canWrite ? (
        <PlanEditor
          key={editor.kind === "create" ? "new" : editor.plan.id}
          editor={editor}
          client={client}
          onDone={done}
          onCancel={() => navigate("/plans")}
          onDelete={
            editor.kind === "edit" ? () => setDeleting(editor.plan) : undefined
          }
          onExpired={onExpired}
        />
      ) : (
        <>
          <div className="plans-filters">
            <label className="plans-search">
              <span className="auth-sr-only">Buscar planos</span>
              <PlanIcon name="search" />
              <input
                placeholder="Buscar por nome ou código"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div
              className="plans-segments"
              role="group"
              aria-label="Situação dos planos"
            >
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
          </div>
          {query.isPending && <p role="status">Carregando planos…</p>}
          {query.isError && (
            <div role="alert">
              <p>{planMessage(query.error)}</p>
              <button onClick={() => void query.refetch()}>
                Tentar novamente
              </button>
            </div>
          )}
          {!query.isError && query.data && (
            <>
              <div className="plans-table-panel">
                <div
                  className="plans-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Catálogo de planos"
                >
                  <table>
                    <caption className="auth-sr-only">
                      Limites e módulos por plano. Valores em reais.
                    </caption>
                    <thead>
                      <tr>
                        {[
                          "Plano",
                          "Preço",
                          "Sincronização",
                          "Histórico",
                          "Limites",
                          "Módulos",
                          "Situação",
                          "Assinaturas",
                          ...(canWrite ? ["Ações"] : []),
                        ].map((h) => (
                          <th key={h} scope="col">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered?.map((plan) => (
                        <tr key={plan.id}>
                          <th scope="row" title={"Revisão " + plan.version}>
                            {plan.name}
                            <small>{plan.code}</small>
                          </th>
                          <td>{money.format(plan.price_cents / 100)}</td>
                          <td>{syncLabel(plan.sync_interval_seconds)}</td>
                          <td>{plan.history_months} meses</td>
                          <td>
                            {plan.max_stores === null
                              ? "Ilimitadas"
                              : plan.max_stores +
                                (plan.max_stores === 1
                                  ? " loja"
                                  : " lojas")}{" "}
                            ·{" "}
                            {plan.max_users === null
                              ? "Ilimitados"
                              : plan.max_users + " usuários"}
                          </td>
                          <td>
                            <div className="plans-modules">
                              {plan.modules.map((m) => (
                                <Pill
                                  key={m}
                                  tone={m === "pulse" ? "warn" : "plan"}
                                >
                                  {m}
                                  {m === "pulse" ? " · fase 2" : ""}
                                </Pill>
                              ))}
                              {!plan.modules.length && "Nenhum"}
                            </div>
                          </td>
                          <td>
                            <Pill tone={plan.active ? "ok" : "neutral"}>
                              {plan.active ? "Ativo" : "Desativado"}
                            </Pill>
                          </td>
                          <td title="Contagem de assinaturas não disponibilizada pela API">
                            —
                          </td>
                          {canWrite && <td>{actions(plan)}</td>}
                        </tr>
                      ))}
                      {!filtered?.length && (
                        <tr>
                          <td
                            className="plans-empty-cell"
                            colSpan={canWrite ? 9 : 8}
                          >
                            {query.data.items.length
                              ? "Nenhum plano corresponde aos filtros nesta página."
                              : "Nenhum plano nesta página."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <footer className="plans-table-footer">
                  <span>
                    {filtered?.length ?? 0} planos nesta página · ordenados por
                    código
                  </span>
                  <nav aria-label="Paginação dos planos">
                    {(history.length > 0 || query.data.next_cursor) && (
                      <>
                        <button
                          disabled={!history.length || query.isFetching}
                          onClick={() => {
                            setAfter(history[history.length - 1]);
                            setHistory(history.slice(0, -1));
                          }}
                        >
                          Página anterior
                        </button>
                        <button
                          disabled={!query.data.next_cursor || query.isFetching}
                          onClick={() => {
                            setHistory([...history, after]);
                            setAfter(query.data.next_cursor ?? "");
                          }}
                        >
                          Próxima página
                        </button>
                      </>
                    )}
                    <button
                      className="plans-refresh"
                      disabled={query.isFetching}
                      onClick={() => void query.refetch()}
                    >
                      <PlanIcon name="refresh" />
                      Atualizar lista
                    </button>
                  </nav>
                </footer>
              </div>
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
                      {syncLabel(plan.sync_interval_seconds)}
                    </p>
                    <p>
                      {plan.max_stores ?? "Ilimitadas"} lojas ·{" "}
                      {plan.max_users ?? "Ilimitados"} usuários
                    </p>
                    <p>{plan.modules.join(", ") || "Nenhum módulo"}</p>
                    {canWrite && actions(plan)}
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {deleting && canWrite && (
        <PlanEditor
          key={"delete-" + deleting.id}
          editor={{ kind: "delete", plan: deleting }}
          client={client}
          onDone={(message) => {
            document
              .querySelectorAll<HTMLFormElement>("form[data-dirty=true]")
              .forEach((form) => {
                form.dataset.dirty = "false";
              });
            done(message);
          }}
          onCancel={() => setDeleting(null)}
          onExpired={onExpired}
        />
      )}
    </section>
  );
}

function PlanEditor({
  editor,
  client,
  onDone,
  onCancel,
  onDelete,
  onExpired,
}: {
  editor: Editor;
  client: PlanClient;
  onDone: (message: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
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
      if (formRef.current?.dataset.dirty === "true" && !submitting.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const controller = useRef(new AbortController());
  const submitting = useRef(false);
  useEffect(() => {
    controller.current = new AbortController();
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
        await client.create(details, controller.current.signal);
      else
        await client.update(
          editor.plan.id,
          { ...details, version: editor.plan.version },
          controller.current.signal,
        );
    },
    onSuccess: () => {
      if (!controller.current.signal.aborted) {
        if (formRef.current) {
          formRef.current.dataset.dirty = "false";
          formRef.current.dataset.saving = "false";
        }
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
    <section className="plans-editor">
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
                if (formRef.current) formRef.current.dataset.dirty = "false";
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
        className="plans-form"
        data-dirty={editor.kind !== "delete" && dirty}
        data-saving={mutation.isPending}
        onChange={(e) => {
          if (editor.kind !== "delete") {
            e.currentTarget.dataset.dirty = "true";
            setDirty(true);
          }
        }}
        onSubmit={submit}
      >
        <fieldset className="plans-fields" disabled={mutation.isPending}>
          {editor.kind === "delete" ? (
            <>
              <p>
                A exclusão de <strong>{original?.name}</strong> é permanente e
                fica registrada na auditoria.
                <br />
                Para confirmar, digite o código <code>{original?.code}</code>.
              </p>
              <label className="plans-delete-field">
                Código do plano
                <input
                  name="confirmation"
                  aria-label={
                    "Digite o código " + original?.code + " para confirmar"
                  }
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
              <PlanFields
                original={original}
                unlimitedStores={unlimitedStores}
                unlimitedUsers={unlimitedUsers}
                setUnlimitedStores={setUnlimitedStores}
                setUnlimitedUsers={setUnlimitedUsers}
              />
            </>
          )}
          <footer
            className={
              editor.kind === "delete"
                ? "plans-dialog-actions"
                : "plans-form-actions"
            }
          >
            {onDelete && (
              <button
                type="button"
                className="plans-outline-danger"
                onClick={onDelete}
              >
                <PlanIcon name="trash" />
                Excluir plano
              </button>
            )}
            <div className="plans-action-right">
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button
                className={
                  editor.kind === "delete" ? "plans-danger" : "plans-primary"
                }
                type="submit"
                disabled={
                  mutation.isPending ||
                  (editor.kind === "delete" &&
                    confirmation.toLowerCase() !== original?.code)
                }
              >
                {mutation.isPending
                  ? editor.kind === "delete"
                    ? "Excluindo…"
                    : "Salvando…"
                  : editor.kind === "delete"
                    ? "Excluir plano"
                    : "Salvar plano"}
              </button>
            </div>
          </footer>
        </fieldset>
      </form>
    </section>
  );
  return editor.kind === "delete" ? (
    <PlanDialog
      title={
        mutation.error instanceof PlanFailure &&
        mutation.error.kind === "plan_in_use"
          ? "Não é possível excluir este plano"
          : "Excluir plano"
      }
      onClose={() => {
        if (!mutation.isPending) onCancel();
      }}
    >
      {content}
    </PlanDialog>
  ) : (
    content
  );
}

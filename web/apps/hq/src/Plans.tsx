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

type Editor = { kind: "create" } | { kind: "edit" | "delete"; plan: Plan };
const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
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
  client: PlanClient;
  onExpired: () => void;
  theme: string;
  toggleTheme: () => void;
}) {
  // Authenticated mount owns its cache. Logout/expiry discards it, not just UI.
  const [queries] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false, gcTime: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queries}>
      <Plans {...props} />
    </QueryClientProvider>
  );
}
function Plans({
  client,
  onExpired,
  theme,
  toggleTheme,
}: {
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
  const query = useQuery({
    queryKey: ["hq-plans", after],
    queryFn: ({ signal }) => client.list(after, signal),
  });
  useEffect(() => {
    if (query.error instanceof PlanFailure && query.error.status === 401)
      onExpired();
  }, [query.error, onExpired]);
  function done(message: string) {
    setEditor(null);
    setNotice(message);
    void cache.invalidateQueries({ queryKey: ["hq-plans"] });
  }
  return (
    <section className="hq-catalog" aria-labelledby="plans-title">
      <header className="hq-heading">
        <div>
          <p className="hq-eyebrow">CONTROLE DA PLATAFORMA</p>
          <h2 id="plans-title">Planos</h2>
        </div>
        <button className="auth-secondary" onClick={toggleTheme}>
          Tema {theme === "dark" ? "claro" : "escuro"}
        </button>
      </header>
      <p>
        Cadastros reais do banco de controle. Nenhum plano comercial é criado
        automaticamente.
      </p>
      <p className="hq-muted">
        Próximas etapas do M1: redes e assinaturas, lojas, pareamento e
        provisionamento isolado. Dados de vendas não são exibidos aqui.
      </p>
      {!canWrite && <p role="status">Acesso de suporte: somente leitura.</p>}
      {notice && <p role="status">{notice}</p>}
      {!editor && canWrite && (
        <button
          onClick={() => {
            setNotice("");
            setEditor({ kind: "create" });
          }}
        >
          Novo plano
        </button>
      )}
      {editor && (
        <PlanEditor
          key={editor.kind === "create" ? "new" : editor.plan.id + editor.kind}
          editor={editor}
          client={client}
          onDone={done}
          onCancel={() => setEditor(null)}
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
      {!query.isError && query.data && (
        <>
          {query.data.items.length === 0 ? (
            <p>Nenhum plano nesta página.</p>
          ) : (
            <div
              className="hq-table-wrap"
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
                    <th scope="col">Limites</th>
                    <th scope="col">Módulos</th>
                    <th scope="col">Situação</th>
                    {canWrite && <th scope="col">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((plan) => (
                    <tr key={plan.id}>
                      <th scope="row">
                        {plan.name}
                        <small>
                          {plan.code} · revisão {plan.version}
                        </small>
                      </th>
                      <td>{money.format(plan.price_cents / 100)}</td>
                      <td>
                        {plan.max_stores ?? "Ilimitadas"} lojas
                        <br />
                        {plan.max_users ?? "Ilimitados"} usuários
                        <br />
                        {plan.history_months} meses
                        <br />
                        Sincronização: {plan.sync_interval_seconds}s
                      </td>
                      <td>{plan.modules.join(", ") || "Nenhum"}</td>
                      <td>{plan.active ? "Ativo" : "Desativado"}</td>
                      {canWrite && (
                        <td className="hq-actions">
                          <button
                            disabled={!!editor}
                            onClick={() => {
                              setNotice("");
                              setEditor({ kind: "edit", plan });
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
              disabled={!query.data.next_cursor || !!editor || query.isFetching}
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
          String(form.get("confirmation") ?? ""),
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
        sync_interval_seconds: Number(form.get("sync")),
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
      if (!controller.current.signal.aborted)
        onDone(editor.kind === "delete" ? "Plano excluído." : "Plano salvo.");
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
  return (
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
      <form onSubmit={submit}>
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
              />
            </label>
          </>
        ) : (
          <>
            <div className="hq-form-grid">
              <label>
                Código
                <input
                  name="code"
                  required
                  pattern="[a-z0-9][a-z0-9_-]{0,63}"
                  maxLength={64}
                  disabled={!!original}
                  defaultValue={original?.code}
                />
                <small>
                  Identificador imutável, em letras minúsculas, números, _ ou -.
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
                Intervalo de sincronização (segundos)
                <input
                  name="sync"
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  required
                  defaultValue={original?.sync_interval_seconds}
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
              <label>
                Máximo de lojas (vazio = ilimitado)
                <input
                  name="stores"
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  defaultValue={original?.max_stores ?? ""}
                />
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
                />
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
                      defaultChecked={original?.modules.includes(module)}
                    />
                    {module}
                    {module === "pulse" ? " (previsto para fase 2)" : ""}
                  </label>
                ),
              )}
              <p>Sem seleção, nenhum módulo é liberado.</p>
            </fieldset>
            <label className="hq-check">
              <input
                name="active"
                type="checkbox"
                defaultChecked={original?.active ?? true}
              />
              Plano ativo
            </label>
            <p>
              Alterações afetam as assinaturas vinculadas. Desativar preserva as
              assinaturas existentes.
            </p>
          </>
        )}
        <div className="hq-actions">
          <button type="submit" disabled={mutation.isPending}>
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
            onClick={onCancel}
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}

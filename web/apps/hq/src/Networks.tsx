import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useScope } from "@crmf/auth";
import {
  NetworkFailure,
  networkMessage,
  type Network,
  type NetworkClient,
  type NetworkInput,
} from "./networks-client";
import { PlanFailure, planMessage, type PlanClient } from "./plans-client";

const labels = {
  queued: "Na fila",
  preparing: "Preparando",
  ready: "Pronta",
  failed: "Falha na preparação",
};
export function Networks({
  client,
  plans,
  onExpired,
  onPlans,
  route,
  navigate,
}: {
  client: NetworkClient;
  plans: PlanClient;
  onExpired: () => void;
  onPlans: () => void;
  route?: string;
  navigate?: (path: string) => void;
  theme: string;
  toggleTheme: () => void;
}) {
  const scope = useScope();
  const canWrite = scope.grants.some((g) => g.role === "platform_admin");
  const [after, setAfter] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [creating, setCreating] = useState(route === "/tenants/new");
  const [search, setSearch] = useState("");
  useEffect(() => setCreating(route === "/tenants/new"), [route]);
  const [notice, setNotice] = useState("");
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["hq-networks", after],
    queryFn: ({ signal }) => client.list(after, signal),
  });
  useEffect(() => {
    if (query.error instanceof NetworkFailure && query.error.status === 401)
      onExpired();
  }, [query.error, onExpired]);
  // No hidden-tab polling that would keep a platform session alive indefinitely.
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!watching) return;
    const end = Date.now() + 120000;
    const timer = window.setInterval(() => {
      if (Date.now() >= end) {
        setWatching(false);
        return;
      }
      if (document.visibilityState === "visible")
        void cache.invalidateQueries({ queryKey: ["hq-networks"] });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [watching, cache]);
  function done() {
    setCreating(false);
    navigate?.("/tenants");
    setNotice(
      "Rede registrada. A preparação será confirmada pelo processo isolado.",
    );
    setWatching(true);
    void cache.invalidateQueries({ queryKey: ["hq-networks"] });
  }
  return (
    <section className="hq-catalog" aria-labelledby="networks-title">
      <header className="hq-heading">
        <div>
          <p className="hq-eyebrow">CONTROLE DA PLATAFORMA</p>
          <h1 tabIndex={-1} id="networks-title">
            Redes
          </h1>
        </div>
      </header>
      <p>
        Cadastre a rede e acompanhe a preparação do banco isolado. Nenhuma loja,
        usuário ou venda é criada automaticamente.
      </p>
      {!canWrite && <p role="status">Acesso de suporte: somente leitura.</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="hq-actions">
        {canWrite && !creating && (
          <button
            onClick={() => {
              setNotice("");
              setCreating(true);
              navigate?.("/tenants/new");
            }}
          >
            Nova rede
          </button>
        )}
        <button
          className="auth-secondary"
          onClick={() => {
            setWatching(true);
            void query.refetch();
          }}
        >
          Atualizar redes
        </button>
        {watching && (
          <span className="hq-muted">Acompanhando por até 2 minutos.</span>
        )}
      </div>
      {creating && (
        <NetworkEditor
          client={client}
          plans={plans}
          onDone={done}
          onCancel={() => {
            setCreating(false);
            navigate?.("/tenants");
          }}
          onExpired={onExpired}
          onPlans={onPlans}
        />
      )}
      {!creating && (
        <div className="qg-filters">
          <label>
            Buscar por nome ou identificador
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <small>
            Filtros nesta página; assinatura, contagens de lojas e dispositivos
            ainda não disponibilizados.
          </small>
        </div>
      )}
      {query.isPending && <p role="status">Carregando redes…</p>}
      {query.isError && (
        <div role="alert">
          <p>{networkMessage(query.error)}</p>
          <button onClick={() => void query.refetch()}>Tentar novamente</button>
        </div>
      )}
      {query.data && query.data.items.length === 0 && (
        <p>Nenhuma rede nesta página. Cadastre uma rede para iniciar.</p>
      )}
      {query.data && query.data.items.length > 0 && (
        <div
          className="hq-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Tabela de redes"
        >
          <table>
            <caption>
              Redes cadastradas — prontidão confirmada pelo provisionador
            </caption>
            <thead>
              <tr>
                <th scope="col">Rede</th>
                <th scope="col">Plano</th>
                <th scope="col">Preparação</th>
                <th scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items
                .filter((n) =>
                  (n.legal_name + " " + n.slug)
                    .toLocaleLowerCase("pt-BR")
                    .includes(search.toLocaleLowerCase("pt-BR")),
                )
                .map((network) => (
                  <tr key={network.id}>
                    <th scope="row">
                      <strong>{network.legal_name}</strong>
                      <small>{network.slug}</small>
                      <small>CNPJ: {network.cnpj}</small>
                    </th>
                    <td>
                      {network.plan_name}
                      <small>
                        {
                          {
                            trial: "Em avaliação",
                            active: "Ativa",
                            suspended: "Suspensa",
                            cancelled: "Cancelada",
                          }[network.status]
                        }
                      </small>
                    </td>
                    <td>
                      <strong>{labels[network.provision_status]}</strong>
                      {network.provision_status === "ready" ? (
                        <small>
                          Banco isolado confirmado · versão{" "}
                          {network.schema_version}
                        </small>
                      ) : (
                        <small>
                          {network.provision_status === "failed"
                            ? "Não foi possível concluir. Tente novamente sem duplicar a rede."
                            : "A rede ainda não está pronta para uso."}
                        </small>
                      )}
                    </td>
                    <td>
                      {canWrite &&
                      network.provision_status === "failed" &&
                      (network.status === "trial" ||
                        network.status === "active") &&
                      network.generation > 0 ? (
                        <RetryNetwork
                          network={network}
                          client={client}
                          onDone={done}
                          onExpired={onExpired}
                        />
                      ) : (
                        <span className="hq-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="hq-actions">
        <button
          className="auth-secondary"
          disabled={!history.length}
          onClick={() => {
            setAfter(history[history.length - 1] ?? "");
            setHistory((v) => v.slice(0, -1));
          }}
        >
          Página anterior
        </button>
        <button
          className="auth-secondary"
          disabled={!query.data?.next_cursor}
          onClick={() => {
            if (query.data?.next_cursor) {
              setHistory((v) => [...v, after]);
              setAfter(query.data.next_cursor);
            }
          }}
        >
          Próxima página
        </button>
      </div>
    </section>
  );
}
function NetworkEditor({
  client,
  plans,
  onDone,
  onCancel,
  onExpired,
  onPlans,
}: {
  client: NetworkClient;
  plans: PlanClient;
  onDone: () => void;
  onCancel: () => void;
  onExpired: () => void;
  onPlans: () => void;
}) {
  const [input, setInput] = useState<NetworkInput>({
    legal_name: "",
    slug: "",
    cnpj: "",
    plan_id: "",
  });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current?.abort();
  }, []);
  const available = useInfiniteQuery({
    queryKey: ["hq-network-plans"],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => plans.list(pageParam, signal),
    getNextPageParam: (page) => page.next_cursor,
  });
  const options =
    available.data?.pages
      .flatMap((page) => page.items)
      .filter((plan) => plan.active) ?? [];
  const mutation = useMutation({
    mutationFn: () => client.create(input, controller.current?.signal),
    onSuccess: onDone,
    onError: (error) => {
      if (error instanceof NetworkFailure && error.status === 401) onExpired();
    },
  });
  useEffect(() => {
    if (
      available.error instanceof PlanFailure &&
      available.error.status === 401
    )
      onExpired();
  }, [available.error, onExpired]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!mutation.isPending) mutation.mutate();
  }
  return (
    <form className="hq-editor" onSubmit={submit}>
      <h3>Nova rede</h3>
      <p>
        O identificador será permanente. Se a preparação falhar, a nova
        tentativa usará esta mesma rede.
      </p>
      <div className="hq-form-grid">
        <label>
          Nome da rede
          <input
            required
            maxLength={200}
            value={input.legal_name}
            onChange={(e) =>
              setInput((v) => ({ ...v, legal_name: e.target.value }))
            }
          />
        </label>
        <label>
          Identificador
          <input
            required
            pattern="[a-z0-9_]{3,40}"
            maxLength={40}
            value={input.slug}
            onChange={(e) => setInput((v) => ({ ...v, slug: e.target.value }))}
          />
          <small>
            3 a 40 letras minúsculas, números ou sublinhado. Não poderá ser
            alterado.
          </small>
        </label>
        <label>
          CNPJ sem pontuação
          <input
            required
            minLength={14}
            maxLength={14}
            pattern="[A-Z0-9]{12}[0-9]{2}"
            value={input.cnpj}
            onChange={(e) =>
              setInput((v) => ({
                ...v,
                cnpj: e.target.value.toUpperCase().replace(/[./-]/g, ""),
              }))
            }
          />
        </label>
        <label>
          Plano
          <select
            aria-label="Plano"
            required
            value={input.plan_id}
            disabled={available.isPending || available.isError}
            onChange={(e) =>
              setInput((v) => ({ ...v, plan_id: e.target.value }))
            }
          >
            <option value="">Selecione um plano ativo</option>
            {options.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} ({plan.code})
              </option>
            ))}
          </select>
        </label>
      </div>
      {available.isPending && <p role="status">Carregando planos…</p>}
      {available.isError && (
        <p role="alert">
          {planMessage(available.error)}{" "}
          <button type="button" onClick={() => void available.refetch()}>
            Recarregar planos
          </button>
        </p>
      )}
      {available.hasNextPage && (
        <button
          type="button"
          disabled={available.isFetchingNextPage}
          onClick={() => void available.fetchNextPage()}
        >
          Carregar mais planos
        </button>
      )}
      {available.isSuccess && !options.length && (
        <p>
          Nenhum plano ativo foi carregado.{" "}
          <button type="button" onClick={onPlans}>
            Ir para Planos
          </button>
        </p>
      )}
      {mutation.isError && <p role="alert">{networkMessage(mutation.error)}</p>}
      <div className="hq-actions">
        <button
          disabled={mutation.isPending || !input.plan_id || available.isError}
        >
          {mutation.isPending ? "Registrando…" : "Cadastrar rede"}
        </button>
        <button
          className="auth-secondary"
          type="button"
          disabled={mutation.isPending}
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
function RetryNetwork({
  network,
  client,
  onDone,
  onExpired,
}: {
  network: Network;
  client: NetworkClient;
  onDone: () => void;
  onExpired: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => client.retry(network),
    onSuccess: onDone,
    onError: (error) => {
      if (error instanceof NetworkFailure && error.status === 401) onExpired();
    },
  });
  return (
    <>
      <button
        disabled={mutation.isPending}
        onClick={() => {
          if (!mutation.isPending) mutation.mutate();
        }}
      >
        {mutation.isPending ? "Solicitando…" : "Tentar preparar novamente"}
      </button>
      {mutation.isError && <p role="alert">{networkMessage(mutation.error)}</p>}
    </>
  );
}

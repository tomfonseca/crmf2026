import { useEffect, useRef, useState } from "react";
import { NetworkEditor } from "./NetworkEditor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useScope } from "@crmf/auth";
import {
  NetworkFailure,
  networkMessage,
  type Network,
  type NetworkClient,
  type NetworkPage,
} from "./networks-client";
import { type PlanClient } from "./plans-client";
import { PlanIcon } from "./PlanPresentation";
import {
  Heading,
  NetworkDetail,
  NetworkSetup,
  PreparationBadge,
} from "./NetworkPresentation";
import "./networks.css";

export function Networks({
  client,
  plans,
  onExpired,
  onPlans,
  route = "/tenants",
  navigate = () => {},
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
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [watching, setWatching] = useState<number | null>(null);
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["hq-networks", after],
    queryFn: ({ signal }) => client.list(after, signal),
  });
  useEffect(() => {
    if (query.error instanceof NetworkFailure && query.error.status === 401)
      onExpired();
  }, [query.error, onExpired]);
  // Monitoring is explicitly requested, visible-only and bounded. No idle keepalive.
  useEffect(() => {
    if (watching === null) return;
    const end = Date.now() + 120000;
    const timer = window.setInterval(() => {
      if (Date.now() >= end) {
        setWatching(null);
        return;
      }
      if (document.visibilityState === "visible")
        void cache.invalidateQueries({ queryKey: ["hq-networks"] });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [watching, cache]);
  function refresh() {
    setWatching(Date.now());
    void query.refetch();
  }
  function done(network: Network) {
    cache.setQueryData<NetworkPage>(["hq-networks", after], (old) => ({
      ...old,
      items: [
        network,
        ...(old?.items ?? []).filter((n) => n.id !== network.id),
      ],
    }));
    setWatching(Date.now());
    void cache.invalidateQueries({ queryKey: ["hq-networks"] });
    navigate(`/tenants/${network.slug}/setup`);
  }
  const pathname = route.split("?")[0];
  const creating =
    pathname === "/tenants/new" &&
    !new URLSearchParams(route.split("?")[1]).has("aba");
  const match = /^\/tenants\/([a-z0-9_]{3,40})(\/setup)?$/.exec(pathname);
  const selected = match
    ? query.data?.items.find((n) => n.slug === match[1])
    : undefined;
  const items = (query.data?.items ?? []).filter(
    (n) =>
      ((n.profile?.data.display_name || n.legal_name) + " " + n.slug)
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")) &&
      (!planFilter || n.plan_id === planFilter),
  );
  function next() {
    if (query.data?.next_cursor) {
      setHistory((v) => [...v, after]);
      setAfter(query.data.next_cursor);
    }
  }
  const errors = (
    <>
      {query.isPending && <p role="status">Carregando redes…</p>}
      {query.isError && (
        <div className="networks-banner networks-error" role="alert">
          {networkMessage(query.error)}{" "}
          <button onClick={refresh}>Tentar novamente</button>
        </div>
      )}
    </>
  );
  const retry =
    selected &&
    canWrite &&
    selected.provision_status === "failed" &&
    ["trial", "active"].includes(selected.status) &&
    selected.generation > 0 ? (
      <RetryNetwork
        network={selected}
        client={client}
        onDone={done}
        onExpired={onExpired}
      />
    ) : null;
  return (
    <section
      className="networks-page plans-page"
      aria-labelledby="networks-title"
    >
      {!canWrite && (
        <p className="networks-banner" role="status">
          Acesso de suporte: somente leitura.
        </p>
      )}
      {creating ? (
        canWrite ? (
          <NetworkEditor
            client={client}
            plans={plans}
            onDone={done}
            onCancel={() => navigate("/tenants")}
            onExpired={onExpired}
            onPlans={onPlans}
          />
        ) : (
          <>
            <Heading title="Cadastrar rede" trail="CLIENTES › REDES › NOVA" />
            <p>Acesso de suporte: o cadastro não está disponível.</p>
          </>
        )
      ) : match ? (
        <>
          {errors}
          {query.isPending ? (
            <Heading title="Carregando rede…" />
          ) : selected ? (
            canWrite &&
            new URLSearchParams(route.split("?")[1]).get("editar") === "1" ? (
              <NetworkEditor
                key={selected.id}
                client={client}
                plans={plans}
                network={selected}
                onExpired={onExpired}
                onPlans={onPlans}
                onCancel={() => navigate(`/tenants/${selected.slug}?aba=dados`)}
                onDone={(n) => {
                  cache.setQueryData<NetworkPage>(
                    ["hq-networks", after],
                    (old) => ({
                      ...old,
                      items: (old?.items ?? []).map((item) =>
                        item.id === n.id ? n : item,
                      ),
                    }),
                  );
                  void cache.invalidateQueries({ queryKey: ["hq-networks"] });
                  navigate(`/tenants/${n.slug}?aba=dados`);
                }}
              />
            ) : match[2] ? (
              <NetworkSetup
                network={selected}
                refresh={refresh}
                retry={retry}
                canWrite={canWrite}
              />
            ) : (
              <NetworkDetail
                network={selected}
                canWrite={canWrite}
                route={route}
                navigate={navigate}
              />
            )
          ) : (
            <>
              <Heading title="Rede não carregada" />
              <p>
                Esta rede não foi carregada nesta página do catálogo. Não foi
                possível confirmar seus dados.
              </p>
              {query.data?.next_cursor && (
                <button onClick={next}>Carregar próxima página</button>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <Heading
            title="Redes"
            subtitle="Redes de farmácias atendidas, com assinatura, lojas e preparação do ambiente."
            action={
              canWrite && (
                <button
                  className="plans-primary"
                  onClick={() => navigate("/tenants/new")}
                >
                  <PlanIcon name="plus" />
                  Cadastrar rede
                </button>
              )
            }
          />
          <div className="networks-filters">
            <label className="plans-search">
              <span className="auth-sr-only">
                Buscar por nome ou identificador
              </span>
              <PlanIcon name="search" />
              <input
                placeholder="Buscar por nome ou identificador"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Assinatura{" "}
              <select
                disabled
                title="Filtro previsto: situação da assinatura ainda não disponibilizada"
              >
                <option>Todas</option>
              </select>
            </label>
            <label>
              Plano{" "}
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {Array.from(
                  new Map(
                    query.data?.items.map((n) => [n.plan_id, n.plan_name]) ??
                      [],
                  ),
                ).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {errors}
          <div className="plans-table-panel networks-table">
            <div
              className="plans-table-scroll"
              role="region"
              aria-label="Tabela de redes"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    {[
                      "Rede",
                      "Plano",
                      "Assinatura",
                      "Lojas",
                      "Dispositivos",
                      "Preparação",
                      "Criada em",
                    ].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((n) => (
                    <tr key={n.id}>
                      <th scope="row">
                        <a
                          href={`/tenants/${n.slug}?aba=dados`}
                          onClick={(e) => {
                            if (
                              !e.ctrlKey &&
                              !e.metaKey &&
                              !e.shiftKey &&
                              !e.altKey
                            ) {
                              e.preventDefault();
                              navigate(`/tenants/${n.slug}?aba=dados`);
                            }
                          }}
                        >
                          {n.profile?.data.display_name || n.legal_name}
                        </a>
                        <small>{n.slug}</small>
                      </th>
                      <td>{n.plan_name}</td>
                      <td>
                        <span title="Situação da assinatura não disponibilizada">
                          —
                        </span>
                      </td>
                      <td title="Contagem de lojas não disponibilizada">—</td>
                      <td title="Telemetria não disponibilizada">—</td>
                      <td>
                        <a
                          href={`/tenants/${n.slug}/setup`}
                          onClick={(e) => {
                            if (
                              !e.ctrlKey &&
                              !e.metaKey &&
                              !e.shiftKey &&
                              !e.altKey
                            ) {
                              e.preventDefault();
                              navigate(`/tenants/${n.slug}/setup`);
                            }
                          }}
                        >
                          <PreparationBadge network={n} />
                        </a>
                      </td>
                      <td title="Data de criação não disponibilizada">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {query.isSuccess && !items.length && (
              <div className="networks-empty">
                <h2>
                  {query.data.items.length
                    ? "Nenhuma rede encontrada"
                    : "Nenhuma rede cadastrada"}
                </h2>
                <p>
                  {query.data.items.length
                    ? "Nenhuma rede corresponde aos filtros desta página."
                    : "Cadastre uma rede para iniciar a preparação do ambiente."}
                </p>
              </div>
            )}
            <footer className="plans-table-footer">
              <span>
                {query.isSuccess ? (
                  <>
                    {items.length} {items.length === 1 ? "rede" : "redes"} nesta
                    página · ordenadas por identificador
                  </>
                ) : (
                  "Contagem não confirmada"
                )}
              </span>
              <nav aria-label="Paginação de redes">
                <button className="plans-refresh" onClick={refresh}>
                  <PlanIcon name="refresh" />
                  Atualizar redes
                </button>
                <button
                  disabled={!history.length}
                  onClick={() => {
                    setAfter(history.at(-1) ?? "");
                    setHistory((v) => v.slice(0, -1));
                  }}
                >
                  Página anterior
                </button>
                <button disabled={!query.data?.next_cursor} onClick={next}>
                  Próxima página
                </button>
              </nav>
            </footer>
          </div>
          <p className="networks-help">
            Filtros nesta página. Assinatura, contagens de lojas, dispositivos e
            datas ainda não disponibilizados: —.
          </p>
        </>
      )}
      {watching !== null && !creating && (
        <p className="networks-help" role="status">
          Acompanhando por até 2 minutos.
        </p>
      )}
    </section>
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
  onDone: (network: Network) => void;
  onExpired: () => void;
}) {
  const controller = useRef<AbortController | null>(null),
    submitting = useRef(false);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current?.abort();
  }, []);
  const mutation = useMutation({
    mutationFn: () => client.retry(network, controller.current?.signal),
    onSuccess: onDone,
    onError: (error) => {
      if (error instanceof NetworkFailure && error.status === 401) onExpired();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  return (
    <div>
      <button
        disabled={mutation.isPending}
        onClick={() => {
          if (!submitting.current) {
            submitting.current = true;
            mutation.mutate();
          }
        }}
      >
        {mutation.isPending ? "Solicitando…" : "Tentar preparar novamente"}
      </button>
      {mutation.isError && <p role="alert">{networkMessage(mutation.error)}</p>}
    </div>
  );
}

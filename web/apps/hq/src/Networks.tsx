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
  type NetworkPage,
} from "./networks-client";
import { PlanFailure, planMessage, type PlanClient } from "./plans-client";
import { PlanIcon } from "./PlanPresentation";
import {
  Heading,
  NetworkCard,
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
      (n.legal_name + " " + n.slug)
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
            match[2] ? (
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
                          {n.legal_name}
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
  onDone: (network: Network) => void;
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
  const dirty = Object.values(input).some(Boolean);
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
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
    onSuccess: (network) => {
      if (form.current) {
        form.current.dataset.dirty = "false";
        form.current.dataset.saving = "false";
      }
      onDone(network);
    },
    onError: (error) => {
      if (error instanceof NetworkFailure && error.status === 401) onExpired();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  useEffect(() => {
    if (
      available.error instanceof PlanFailure &&
      available.error.status === 401
    )
      onExpired();
  }, [available.error, onExpired]);
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!submitting.current) {
      submitting.current = true;
      mutation.mutate();
    }
  }
  return (
    <>
      <Heading title="Cadastrar rede" trail="CLIENTES › REDES › NOVA" />
      <form
        ref={form}
        className="networks-form"
        data-dirty={dirty}
        data-saving={mutation.isPending}
        data-draft-label="nesta rede"
        onSubmit={submit}
      >
        <fieldset disabled={mutation.isPending} className="networks-fields">
          <div className="networks-form-grid">
            <NetworkCard title="Identificação">
              <label>
                Nome da rede <span aria-hidden="true">*</span>
                <input
                  aria-label="Nome da rede"
                  required
                  maxLength={200}
                  value={input.legal_name}
                  onChange={(e) =>
                    setInput((v) => ({ ...v, legal_name: e.target.value }))
                  }
                />
                <small>Nome cadastrado no QG e no Dash.</small>
              </label>
              <label>
                Identificador <span aria-hidden="true">*</span>
                <input
                  aria-label="Identificador"
                  required
                  pattern="[a-z0-9_]{3,40}"
                  maxLength={40}
                  value={input.slug}
                  onChange={(e) =>
                    setInput((v) => ({ ...v, slug: e.target.value }))
                  }
                />
                <small>
                  3 a 40 letras minúsculas, números ou sublinhado.{" "}
                  <strong>Não pode ser alterado depois da criação.</strong>
                </small>
              </label>
            </NetworkCard>
            <NetworkCard
              title="Dados cadastrais"
              subtitle="Usados em cobrança e suporte"
            >
              <label>
                Razão social
                <input
                  disabled
                  placeholder="Previsto · campo separado ainda indisponível"
                />
              </label>
              <label>
                CNPJ <span aria-hidden="true">*</span>
                <input
                  aria-label="CNPJ sem pontuação"
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
                <small>
                  Sem pontuação; validação de formato, não de cadastro fiscal.
                </small>
              </label>
              <div className="networks-city">
                <label>
                  Cidade
                  <input disabled placeholder="Previsto" />
                </label>
                <label>
                  UF
                  <select disabled>
                    <option>UF</option>
                  </select>
                </label>
              </div>
            </NetworkCard>
            <NetworkCard title="Contato comercial">
              <label>
                Nome do contato
                <input disabled placeholder="Previsto" />
              </label>
              <label>
                E-mail do contato
                <input disabled placeholder="Previsto" />
                <small>
                  Não é o administrador da rede; o convite de acesso é feito
                  depois, na aba Usuários. Serviço de convites previsto.
                </small>
              </label>
            </NetworkCard>
            <NetworkCard title="Assinatura">
              <label>
                Plano <span aria-hidden="true">*</span>
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
                <small>
                  Só planos ativos aparecem. A assinatura em avaliação é
                  reservada com o cadastro.
                </small>
              </label>
              {available.isPending && <p role="status">Carregando planos…</p>}
              {available.isError && (
                <div role="alert">
                  {planMessage(available.error)}{" "}
                  <button
                    type="button"
                    onClick={() => void available.refetch()}
                  >
                    Recarregar planos
                  </button>
                </div>
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
              <label>
                Fuso horário padrão das lojas
                <select disabled>
                  <option>Previsto · ainda não configurado</option>
                </select>
              </label>
              <label>
                Identificador de cobrança (opcional)
                <input
                  disabled
                  placeholder="Previsto · ID do cliente no gateway"
                />
                <small>Integração de cobrança ainda não disponibilizada.</small>
              </label>
            </NetworkCard>
          </div>
        </fieldset>
        {mutation.isError && (
          <p className="networks-banner networks-error" role="alert">
            {networkMessage(mutation.error)}
          </p>
        )}
        <p className="networks-banner">
          Ao salvar, o QG prepara o ambiente isolado da rede (schema e
          permissões). Isso pode levar alguns minutos; você acompanha o
          progresso na tela seguinte.
        </p>
        <footer className="networks-form-actions">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            className="plans-primary"
            disabled={mutation.isPending || !input.plan_id || available.isError}
          >
            {mutation.isPending ? "Salvando…" : "Cadastrar e preparar"}
          </button>
        </footer>
      </form>
    </>
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

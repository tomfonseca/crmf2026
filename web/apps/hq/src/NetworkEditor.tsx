import { useEffect, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Heading, NetworkCard } from "./NetworkPresentation";
import {
  NetworkFailure,
  networkMessage,
  emptyNetworkProfile,
  type Network,
  type NetworkClient,
  type NetworkInput,
  type NetworkProfileInput,
} from "./networks-client";
import { PlanFailure, planMessage, type PlanClient } from "./plans-client";

export function NetworkEditor({
  client,
  plans,
  network,
  onDone,
  onCancel,
  onExpired,
  onPlans,
}: {
  client: NetworkClient;
  plans: PlanClient;
  network?: Network;
  onDone: (n: Network) => void;
  onCancel: () => void;
  onExpired: () => void;
  onPlans: () => void;
}) {
  const [input, setInput] = useState<NetworkInput>(() => ({
    legal_name:
      network?.profile?.data.display_name || network?.legal_name || "",
    slug: network?.slug || "",
    cnpj: network?.cnpj || "",
    plan_id: network?.plan_id || "",
    profile: network?.profile?.data || emptyNetworkProfile(),
  }));
  const [initial] = useState(() => JSON.stringify(input));
  const [version] = useState(network?.profile?.version ?? 0);
  const profile = input.profile ?? emptyNetworkProfile();
  const dirty = JSON.stringify(input) !== initial;
  const form = useRef<HTMLFormElement>(null),
    controller = useRef<AbortController | null>(null),
    lookupController = useRef<AbortController | null>(null),
    submitting = useRef(false);
  const automatic = useRef<Partial<NetworkProfileInput>>({});
  const autoName = useRef("");
  const [lookupState, setLookupState] = useState(""),
    [looking, setLooking] = useState(false);
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      controller.current?.abort();
      lookupController.current?.abort();
    };
  }, []);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const available = useInfiniteQuery({
    queryKey: ["hq-network-plans"],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => plans.list(pageParam, signal),
    getNextPageParam: (p) => p.next_cursor,
    enabled: !network,
  });
  useEffect(() => {
    if (
      available.error instanceof PlanFailure &&
      available.error.status === 401
    )
      onExpired();
  }, [available.error, onExpired]);
  const options =
    available.data?.pages.flatMap((p) => p.items).filter((p) => p.active) ?? [];
  const mutation = useMutation({
    mutationFn: async () =>
      network
        ? {
            ...network,
            profile: await client.updateProfile(
              network,
              { version, data: { ...profile, display_name: input.legal_name } },
              controller.current?.signal,
            ),
          }
        : client.create(
            {
              ...input,
              profile: { ...profile, display_name: input.legal_name },
            },
            controller.current?.signal,
          ),
    onSuccess: (n) => {
      if (form.current) {
        form.current.dataset.dirty = "false";
        form.current.dataset.saving = "false";
      }
      onDone(n);
    },
    onError: (e) => {
      if (e instanceof NetworkFailure && e.status === 401) onExpired();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  function change(key: keyof NetworkProfileInput, value: string) {
    setInput((v) => ({
      ...v,
      profile: { ...emptyNetworkProfile(), ...v.profile, [key]: value },
    }));
  }
  async function lookup(cnpj: string) {
    lookupController.current?.abort();
    const own = new AbortController();
    lookupController.current = own;
    setLooking(true);
    setLookupState("Consultando CNPJ…");
    try {
      const found = await client.lookup(cnpj, own.signal);
      if (own.signal.aborted) return;
      setInput((v) => {
        if (v.cnpj !== cnpj) return v;
        const next = { ...emptyNetworkProfile(), ...v.profile };
        const applied: Partial<NetworkProfileInput> = {};
        for (const key of ["registered_name", "city", "uf"] as const) {
          if (!next[key] && found[key]) {
            next[key] = found[key];
            applied[key] = found[key];
          }
        }
        automatic.current = applied;
        autoName.current = !v.legal_name ? found.display_name : "";
        return {
          ...v,
          legal_name: v.legal_name || found.display_name,
          profile: next,
        };
      });
      setLookupState(
        "Dados consultados via BrasilAPI / Minha Receita. Confira antes de salvar; campos preenchidos manualmente foram preservados.",
      );
    } catch (e) {
      if (own.signal.aborted) return;
      if (e instanceof NetworkFailure && e.status === 401) onExpired();
      setLookupState(
        e instanceof NetworkFailure && e.status === 404
          ? "CNPJ não encontrado. Confira ou preencha manualmente."
          : e instanceof NetworkFailure && e.status === 429
            ? "Limite de consultas atingido. Preencha manualmente ou consulte mais tarde."
            : "Consulta indisponível. Você pode preencher manualmente.",
      );
    } finally {
      if (lookupController.current === own) setLooking(false);
    }
  }
  function changeCNPJ(raw: string) {
    const cnpj = raw.toUpperCase().replace(/[./\s-]/g, "");
    lookupController.current?.abort();
    setLooking(false);
    setLookupState("");
    const previous = automatic.current,
      previousName = autoName.current;
    automatic.current = {};
    autoName.current = "";
    setInput((v) => {
      const next = { ...emptyNetworkProfile(), ...v.profile };
      for (const key of ["registered_name", "city", "uf"] as const) {
        if (previous[key] && next[key] === previous[key]) next[key] = "";
      }
      return {
        ...v,
        cnpj,
        legal_name:
          previousName && v.legal_name === previousName ? "" : v.legal_name,
        profile: next,
      };
    });
    if (/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) void lookup(cnpj);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!submitting.current && !looking) {
      submitting.current = true;
      mutation.mutate();
    }
  }
  function field(key: keyof NetworkProfileInput, label: string, type = "text") {
    return (
      <label>
        {label}
        <input
          aria-label={label}
          type={type}
          maxLength={200}
          value={profile[key]}
          onChange={(e) => change(key, e.target.value)}
        />
      </label>
    );
  }
  return (
    <>
      <Heading
        title={network ? "Editar rede" : "Cadastrar rede"}
        trail={
          network ? "CLIENTES › REDES › EDITAR" : "CLIENTES › REDES › NOVA"
        }
      />
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
                <small>Nome de apresentação no QG e no Dash.</small>
              </label>
              <label>
                Identificador <span aria-hidden="true">*</span>
                <input
                  aria-label="Identificador"
                  required
                  pattern="[a-z0-9_]{3,40}"
                  maxLength={40}
                  disabled={!!network}
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
              {field("registered_name", "Razão social")}
              <label>
                CNPJ <span aria-hidden="true">*</span>
                <input
                  aria-label="CNPJ sem pontuação"
                  required
                  minLength={14}
                  maxLength={18}
                  pattern="[A-Z0-9]{12}[0-9]{2}"
                  disabled={!!network}
                  value={input.cnpj}
                  onChange={(e) => changeCNPJ(e.target.value)}
                />
                <small>
                  {network
                    ? "Identidade fiscal preservada; esta edição altera somente os dados comerciais."
                    : "Ao completar 14 caracteres, consultamos os dados públicos. A consulta não comprova a situação fiscal."}
                </small>
              </label>
              {!network && (
                <>
                  <button
                    type="button"
                    disabled={looking || input.cnpj.length !== 14}
                    onClick={() => void lookup(input.cnpj)}
                  >
                    Consultar CNPJ
                  </button>
                  <p role="status" aria-live="polite">
                    {lookupState}
                  </p>
                </>
              )}
              <div className="networks-city">
                {field("city", "Cidade")}
                <label>
                  UF
                  <select
                    aria-label="UF"
                    value={profile.uf}
                    onChange={(e) => change("uf", e.target.value)}
                  >
                    <option value="">UF</option>
                    {"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
                      .split(" ")
                      .map((uf) => (
                        <option key={uf}>{uf}</option>
                      ))}
                  </select>
                </label>
              </div>
            </NetworkCard>
            <NetworkCard title="Contato comercial">
              {field("contact_name", "Nome do contato")}
              {field("contact_email", "E-mail do contato", "email")}
              <small>
                Não cria usuário nem envia convite. O administrador da rede é
                definido no fluxo de acesso.
              </small>
            </NetworkCard>
            <NetworkCard title="Assinatura">
              <label>
                Plano <span aria-hidden="true">*</span>
                <select
                  aria-label="Plano"
                  required
                  value={input.plan_id}
                  disabled={
                    !!network || available.isPending || available.isError
                  }
                  onChange={(e) =>
                    setInput((v) => ({ ...v, plan_id: e.target.value }))
                  }
                >
                  <option value="">Selecione um plano ativo</option>
                  {network ? (
                    <option value={network.plan_id}>{network.plan_name}</option>
                  ) : (
                    options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.code})
                      </option>
                    ))
                  )}
                </select>
                <small>
                  {network
                    ? "Troca de plano é uma operação separada; não é realizada nesta edição."
                    : "Só planos ativos aparecem. A assinatura em avaliação é reservada com o cadastro."}
                </small>
              </label>
              {!network && (
                <>
                  {available.isPending && (
                    <p role="status">Carregando planos…</p>
                  )}
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
                </>
              )}
              <label>
                Fuso horário padrão das lojas
                <select
                  aria-label="Fuso horário padrão das lojas"
                  value={profile.default_timezone}
                  onChange={(e) => change("default_timezone", e.target.value)}
                >
                  <option value="">Não configurado</option>
                  {[
                    "America/Sao_Paulo",
                    "America/Manaus",
                    "America/Cuiaba",
                    "America/Campo_Grande",
                    "America/Porto_Velho",
                    "America/Boa_Vista",
                    "America/Rio_Branco",
                    "America/Noronha",
                    "America/Bahia",
                    "America/Fortaleza",
                    "America/Recife",
                    "America/Belem",
                    "America/Maceio",
                    "America/Araguaina",
                    "America/Santarem",
                    "America/Eirunepe",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <small>
                  Configuração para novos cadastros; não infere o fuso do ERP
                  nem altera lojas existentes.
                </small>
              </label>
              {field(
                "billing_customer_id",
                "Identificador de cobrança (opcional)",
              )}
              <small>
                Referência comercial manual. Não cria cliente, assinatura ou
                cobrança no gateway.
              </small>
            </NetworkCard>
          </div>
        </fieldset>
        {mutation.isError && (
          <p className="networks-banner networks-error" role="alert">
            {networkMessage(mutation.error)}
          </p>
        )}
        {!network && (
          <p className="networks-banner">
            Ao salvar, o QG prepara o ambiente isolado da rede (schema e
            permissões). Isso pode levar alguns minutos; você acompanha o
            progresso na tela seguinte.
          </p>
        )}
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
            disabled={
              mutation.isPending ||
              looking ||
              !input.plan_id ||
              (!network && available.isError)
            }
          >
            {mutation.isPending
              ? "Salvando…"
              : network
                ? "Salvar alterações"
                : "Cadastrar e preparar"}
          </button>
        </footer>
      </form>
    </>
  );
}

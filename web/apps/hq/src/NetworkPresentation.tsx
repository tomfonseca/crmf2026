import { type ReactNode } from "react";
import type { Network } from "./networks-client";
import { PlanIcon } from "./PlanPresentation";

export function Heading({
  title,
  trail = "CLIENTES",
  subtitle,
  action,
  badge,
}: {
  title: string;
  trail?: string;
  subtitle?: string;
  action?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header className="plans-heading">
      <div>
        <div className="plans-breadcrumb">{trail}</div>
        <div className="networks-title-row">
          <h1 id="networks-title" tabIndex={-1}>
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
export function NetworkCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="networks-card">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="networks-card-body">{children}</div>
    </section>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`networks-badge networks-${tone}`}>{children}</span>;
}
export function PreparationBadge({ network: n }: { network: Network }) {
  return (
    <Badge
      tone={
        n.provision_status === "ready"
          ? "ok"
          : n.provision_status === "failed"
            ? "danger"
            : "neutral"
      }
    >
      {
        {
          ready: "Concluída",
          failed: "Falhou",
          queued: "Na fila",
          preparing: "Preparando",
        }[n.provision_status]
      }
    </Badge>
  );
}
function Values({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="networks-values">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function NetworkSetup({
  network: n,
  refresh,
  retry,
  canWrite = false,
}: {
  network: Network;
  refresh: () => void;
  retry: ReactNode;
  canWrite?: boolean;
}) {
  const ready = n.provision_status === "ready" && n.schema_version > 0;
  const steps = [
    ["Cadastro salvo", "Rede e identificador registrados", "Concluído", true],
    [
      "Criar schema e permissões",
      "Ambiente isolado da rede no banco analítico",
      ready ? "Concluído" : "Não informado",
      ready,
    ],
    [
      "Aplicar migrações",
      "Estrutura de tabelas da rede",
      ready ? "Concluído" : "Não informado",
      ready,
    ],
    [
      "Criar assinatura",
      `${n.plan_name} · reservada com o cadastro`,
      "Reservada",
      true,
    ],
    [
      "Liberar convites",
      "Serviço de convites ainda não implementado",
      "Previsto",
      false,
    ],
  ] as const;
  return (
    <>
      <Heading
        title="Preparação da rede"
        trail={`CLIENTES › REDES › ${n.slug}`}
        subtitle={n.profile?.data.display_name || n.legal_name}
      />
      <NetworkCard title="Preparação do ambiente">
        <Values
          items={[
            ["Rede", n.profile?.data.display_name || n.legal_name],
            [
              "Identificador",
              <>
                <code>{n.slug}</code> · imutável
              </>,
            ],
            ["Iniciada", "Não disponível"],
            ["Tentativa", n.generation > 0 ? n.generation : "Não disponível"],
          ]}
        />
        <ol
          className="networks-steps"
          role="status"
          aria-live="polite"
          aria-label="Etapas da preparação"
        >
          {steps.map(([title, description, status, complete], i) => (
            <li key={title}>
              <span
                className={`networks-step-icon ${complete ? "networks-ok" : "networks-neutral"}`}
                aria-hidden="true"
              >
                {complete ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                ) : (
                  "···"
                )}
              </span>
              <div>
                <h3>
                  {i + 1}. {title}
                </h3>
                <p>{description}</p>
              </div>
              <span
                className={
                  complete ? "networks-step-complete" : "networks-help"
                }
              >
                {status}
              </span>
            </li>
          ))}
        </ol>
        <p className="networks-overall" role="status">
          <PreparationBadge network={n} />{" "}
          <span>
            {ready
              ? "Banco isolado confirmado · versão " + n.schema_version
              : "A rede ainda não está pronta para uso."}
          </span>
        </p>
        <p className="networks-help">
          As etapas intermediárias não são informadas pelo serviço. Schema e
          migrações só são confirmados quando a preparação termina.
        </p>
        <div className="networks-setup-actions">
          <button onClick={refresh}>
            <PlanIcon name="refresh" />
            Atualizar redes
          </button>
          {ready && canWrite && (
            <button disabled title="Previsto">
              Convidar administrador
            </button>
          )}
        </div>
        {n.provision_status === "failed" && (
          <div className="networks-banner networks-error" role="alert">
            <p>
              Não foi possível concluir a preparação. A nova tentativa usará
              esta mesma rede, sem duplicar o cadastro.
            </p>
            {retry}
          </div>
        )}
      </NetworkCard>
      <p className="networks-banner">
        A preparação continua mesmo que você saia desta tela. Você pode
        acompanhar pela lista de redes.
      </p>
    </>
  );
}
const tabs = [
  ["dados", "Dados cadastrais"],
  ["assinatura", "Assinatura e plano"],
  ["lojas", "Lojas"],
  ["usuarios", "Usuários"],
  ["cobranca", "Eventos de cobrança"],
] as const;
function PlannedTable({
  columns,
  note,
  resources,
}: {
  columns: string[];
  note: string;
  resources?: string[];
}) {
  return (
    <>
      <div className="networks-detail-table">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          {resources && (
            <tbody>
              {resources.map((resource) => (
                <tr key={resource}>
                  <th scope="row">{resource}</th>
                  {columns.slice(1).map((c) => (
                    <td key={c} title="Não disponível">
                      —
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      <div className="networks-empty">
        <Badge>Previsto</Badge>
        <p>{note}</p>
      </div>
    </>
  );
}
export function NetworkDetail({
  network: n,
  canWrite,
  route,
  navigate,
}: {
  network: Network;
  canWrite: boolean;
  route: string;
  navigate: (path: string) => void;
}) {
  const raw = new URLSearchParams(route.split("?")[1]).get("aba");
  const active = tabs.some(([id]) => id === raw) ? raw : "dados";
  const planned = (label: string, danger = false) => (
    <button
      className={danger ? "plans-outline-danger" : undefined}
      disabled
      title="Previsto · serviço ainda não disponibilizado"
    >
      {label}
    </button>
  );
  return (
    <>
      <Heading
        title={n.profile?.data.display_name || n.legal_name}
        trail={`CLIENTES › REDES › ${n.slug}`}
        subtitle={`Identificador ${n.slug} · lojas: —`}
        badge={
          <Badge
            tone={
              n.status === "active"
                ? "ok"
                : n.status === "trial"
                  ? "neutral"
                  : "danger"
            }
          >
            Rede:{" "}
            {
              {
                trial: "Em avaliação",
                active: "Ativa",
                suspended: "Suspensa",
                cancelled: "Cancelada",
              }[n.status]
            }
          </Badge>
        }
        action={
          canWrite && (
            <div className="networks-heading-actions">
              {planned(
                n.status === "suspended" ? "Reativar rede" : "Suspender",
                true,
              )}
              {planned("Cancelar rede", true)}
            </div>
          )
        }
      />
      <div
        className="networks-tabs"
        role="tablist"
        aria-label="Detalhes da rede"
      >
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            role="tab"
            id={`network-tab-${id}`}
            aria-selected={id === active}
            aria-controls="network-panel"
            tabIndex={id === active ? 0 : -1}
            onClick={() => navigate(`/tenants/${n.slug}?aba=${id}`)}
            onKeyDown={(e) => {
              const next =
                e.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : e.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? tabs.length - 1
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                const buttons =
                  e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                buttons?.[next].focus();
                buttons?.[next].click();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="network-panel"
        role="tabpanel"
        aria-labelledby={`network-tab-${active}`}
      >
        {active === "dados" && (
          <NetworkCard
            title="Dados cadastrais"
            action={
              canWrite && (
                <button
                  onClick={() =>
                    navigate(`/tenants/${n.slug}?aba=dados&editar=1`)
                  }
                >
                  Editar
                </button>
              )
            }
          >
            <Values
              items={[
                ["Nome", n.profile?.data.display_name || n.legal_name],
                [
                  "Identificador",
                  <>
                    <code>{n.slug}</code> <Badge>Imutável</Badge>
                  </>,
                ],
                [
                  "Razão social",
                  n.profile?.data.registered_name || "Não disponível",
                ],
                ["CNPJ", n.cnpj],
                [
                  "Cidade/UF",
                  [n.profile?.data.city, n.profile?.data.uf]
                    .filter(Boolean)
                    .join(" / ") || "Não disponível",
                ],
                [
                  "Contato comercial",
                  [n.profile?.data.contact_name, n.profile?.data.contact_email]
                    .filter(Boolean)
                    .join(" · ") || "Não disponível",
                ],
                [
                  "Fuso padrão",
                  n.profile?.data.default_timezone || "Não disponível",
                ],
                [
                  "Identificador de cobrança",
                  n.profile?.data.billing_customer_id || "Não disponível",
                ],
                ["Criada em", "Não disponível"],
                [
                  "Preparação",
                  <>
                    <PreparationBadge network={n} />{" "}
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
                      Ver etapas
                    </a>
                  </>,
                ],
              ]}
            />
          </NetworkCard>
        )}
        {active === "assinatura" && (
          <div className="networks-detail-stack">
            <NetworkCard
              title="Assinatura"
              action={canWrite && planned("Trocar plano")}
            >
              <Values
                items={[
                  ["Plano", n.plan_name],
                  ["Situação", "Não disponível"],
                  ["Início", "Não disponível"],
                  ["Próximo ciclo", "Não disponível"],
                  ["Tolerância", "Não disponível"],
                  ["ID de cobrança", "Não disponível"],
                ]}
              />
            </NetworkCard>
            <NetworkCard
              title="Limites e módulos efetivos"
              action={canWrite && planned("Editar ajustes")}
            >
              <PlannedTable
                columns={[
                  "Recurso",
                  "No plano",
                  "Ajuste da assinatura",
                  "Efetivo",
                  "Origem",
                ]}
                resources={[
                  "Máximo de lojas",
                  "Máximo de usuários",
                  "Histórico",
                  "Sincronização",
                  "Módulos",
                ]}
                note="Limites e ajustes da assinatura ainda não disponibilizados. Não é possível confirmar os valores efetivos."
              />
            </NetworkCard>
            <NetworkCard title="Histórico da assinatura">
              <PlannedTable
                columns={["Data", "Evento", "Situação resultante"]}
                note="Histórico ainda não disponibilizado."
              />
            </NetworkCard>
            <p className="networks-help">
              O QG não faz cobrança nem coleta pagamento.
            </p>
          </div>
        )}
        {active === "lojas" && (
          <NetworkCard
            title="Lojas"
            action={
              canWrite && (
                <button onClick={() => navigate("/stores/new")}>
                  Cadastrar loja
                </button>
              )
            }
          >
            <PlannedTable
              columns={[
                "Loja",
                "Cidade/UF",
                "ERP",
                "Dados",
                "Dispositivo",
                "Última atualização",
              ]}
              note="Lojas e consumo do limite do plano ainda não disponibilizados."
            />
          </NetworkCard>
        )}
        {active === "usuarios" && (
          <NetworkCard
            title="Usuários"
            action={canWrite && planned("Convidar administrador")}
          >
            <PlannedTable
              columns={[
                "Usuário",
                "Papel",
                "Situação",
                "Último acesso",
                "Ações",
              ]}
              note="Serviço de convites previsto. Nenhum convite foi enviado por esta tela."
            />
            <p className="networks-help">
              O QG convida só o primeiro administrador. Os demais usuários são
              gerenciados pela rede. Não há impersonação.
            </p>
          </NetworkCard>
        )}
        {active === "cobranca" && (
          <NetworkCard title="Eventos de cobrança">
            <PlannedTable
              columns={["Data", "Tipo", "Origem", "ID do evento", "Efeito"]}
              note="Eventos de cobrança ainda não disponibilizados."
            />
            <p className="networks-help">
              Somente leitura. O QG não faz cobrança nem coleta pagamento.
            </p>
          </NetworkCard>
        )}
      </div>
      <p className="networks-help">
        Situação da assinatura ainda não disponibilizada.
      </p>
    </>
  );
}

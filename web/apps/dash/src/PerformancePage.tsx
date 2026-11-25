import { Link } from "@tanstack/react-router";
import { Badge, EmptyState, Icon, KpiCard, Panel } from "@crmf/ui";
import { LineChart } from "@crmf/charts";
import { useFilters } from "./filters";
import { useTheme } from "./DashboardShell";
import { PageState, useDemoRefresh } from "./PageState";
import {
  annualSeries,
  DEMO_TODAY,
  metricValue,
  money,
  monthRange,
  number,
  percent,
  ratio,
  summarize,
  type Metric,
} from "./demo/data";

export function PerformancePage() {
  const { filters, update } = useFilters();
  const theme = useTheme();
  const refresh = useDemoRefresh();
  const range = monthRange(filters.year, filters.month);
  const data = summarize(filters.store, range.from, range.to, filters.scenario);
  const previousMonth = filters.month === 1 ? 12 : filters.month - 1;
  const previousYear = filters.month === 1 ? filters.year - 1 : filters.year;
  const previousRange = monthRange(previousYear, previousMonth);
  const previousEnd = new Date(
    Date.parse(previousRange.from) +
      Math.max(0, Math.min(data.elapsed, Number(previousRange.to.slice(-2)))) *
        86400000 -
      86400000,
  )
    .toISOString()
    .slice(0, 10);
  const previous = summarize(
    filters.store,
    previousRange.from,
    previousEnd,
    filters.scenario,
  );
  const variation =
    filters.scenario === "no-base" || previousYear < 2025 || data.elapsed === 0
      ? null
      : ratio(data.net - previous.net, previous.net);
  const points = annualSeries(filters);
  const available = points.filter(
    (p): p is { label: string; value: number } => p.value !== null,
  );
  const annual = summarize(
    filters.store,
    `${filters.year}-01-01`,
    `${filters.year}-12-31`,
    filters.scenario,
  );
  const annualValue =
    filters.metric === "coupons"
      ? annual.coupons
      : filters.metric === "ticket"
        ? annual.coupons
          ? annual.net / annual.coupons / 100
          : null
        : annual.net / 100;
  const average = available.length
    ? available.reduce((sum, p) => sum + p.value, 0) / available.length
    : null;
  const best =
    data.net === 0 && filters.scenario === "empty"
      ? null
      : available.reduce<{ label: string; value: number } | null>(
          (max, p) => (!max || p.value > max.value ? p : max),
          null,
        );
  const indicator =
    filters.metric === "net"
      ? "Venda líquida"
      : filters.metric === "coupons"
        ? "Clientes atendidos"
        : "Ticket médio";
  const priorities = [...data.rows]
    .sort(
      (a, b) =>
        Math.max(0, (b.target ?? 0) - b.net) -
        Math.max(0, (a.target ?? 0) - a.net),
    )
    .slice(0, 3);
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2026, i, 1)).toLocaleDateString("pt-BR", {
      month: "long",
      timeZone: "UTC",
    }),
  );
  const activeMonth = range.from <= DEMO_TODAY && range.to >= DEMO_TODAY;
  return (
    <>
      <div className="page-heading">
        <div>
          <nav className="breadcrumb" aria-label="Trilha">
            CRM Farma › Painel
          </nav>
          <h1 id="page-title">Meu desempenho</h1>
        </div>
        <div className="filters-row">
          <label className="sr-only" htmlFor="month">
            Mês
          </label>
          <select
            id="month"
            value={filters.month}
            onChange={(e) => update({ month: Number(e.target.value) })}
          >
            {months.map((m, i) => (
              <option key={m} value={i + 1}>
                {m[0].toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="year">
            Ano
          </label>
          <select
            id="year"
            value={filters.year}
            onChange={(e) => update({ year: Number(e.target.value) })}
          >
            <option>2026</option>
            <option>2025</option>
          </select>
          <Badge tone={activeMonth ? "accent" : "neutral"}>
            {activeMonth
              ? "Mês em andamento · parcial"
              : range.from > DEMO_TODAY
                ? "Período futuro"
                : "Período encerrado"}
          </Badge>
          <button
            className="button button--primary"
            disabled={refresh.busy}
            onClick={() => refresh.refresh()}
          >
            <Icon name="refresh" size={16} />
            Atualizar
          </button>
        </div>
      </div>
      <main
        id="main-content"
        className="page-content"
        aria-labelledby="page-title"
        tabIndex={-1}
      >
        {refresh.updated && (
          <p className="small muted" role="status">
            Demonstração atualizada localmente. Nenhuma API foi consultada.
          </p>
        )}
        <PageState busy={refresh.busy} retry={() => refresh.refresh(true)}>
          <div className="kpi-grid performance-kpis">
            <KpiCard
              label="Venda líquida"
              value={money(data.net)}
              hint={`Loja: ${money(data.storeNet)}`}
              icon="cash"
            />
            <KpiCard
              label="Clientes atendidos"
              value={number(data.coupons)}
              hint={`Cupons simulados · loja: ${number(data.storeCoupons)}`}
              icon="users"
            />
            <KpiCard
              label="Ticket médio"
              value={
                data.coupons ? money(data.net / data.coupons) : "Sem dados"
              }
              hint="Venda líquida ÷ cupons"
              icon="cart"
            />
            <KpiCard
              label="CMV"
              value={money(data.cost)}
              hint={
                data.cost === null
                  ? "Custo histórico sem cobertura"
                  : `${percent(ratio(data.cost, data.net))} da venda líquida`
              }
              icon="box"
            />
            <KpiCard
              label="Fidelidade"
              value={percent(
                data.loyalty === null ? null : ratio(data.loyalty, data.net),
              )}
              hint={
                data.loyalty === null
                  ? "Cobertura não disponível"
                  : money(data.loyalty)
              }
              icon="heart"
            />
            <KpiCard
              label="Participação na loja"
              value={percent(ratio(data.net, data.storeNet))}
              hint={`Cupons: ${percent(ratio(data.coupons, data.storeCoupons))}`}
              icon="pie"
            />
          </div>
          <div className="two-columns">
            <Panel
              title="Leitura do mês"
              subtitle="Ritmo e tendência no mesmo período"
            >
              {data.net === 0 ? (
                <p className="muted">
                  Não há vendas registradas para este período.
                </p>
              ) : (
                <div className="reading">
                  <div>
                    <span className="muted small">
                      Em relação ao mesmo intervalo do mês anterior
                    </span>
                    <strong
                      className={
                        variation === null
                          ? "reading-value muted"
                          : variation >= 0
                            ? "reading-value positive"
                            : "reading-value warning"
                      }
                    >
                      {variation !== null && variation > 0 ? "+" : ""}
                      {percent(variation)}
                    </strong>
                  </div>
                  <p>
                    Você realizou <b>{money(data.net)}</b> em{" "}
                    <b>{data.elapsed} dias</b>, com ticket médio de{" "}
                    <b>
                      {data.coupons
                        ? money(data.net / data.coupons)
                        : "Sem base"}
                    </b>
                    .
                  </p>
                  <p className="small muted">
                    {variation === null
                      ? "Não há base suficiente para comparar períodos."
                      : "Comparação com a mesma quantidade de dias corridos; dados exclusivamente simulados."}
                  </p>
                </div>
              )}
            </Panel>
            <Panel
              title="Onde agir hoje"
              subtitle="Prioridades ordenadas pelo maior desvio"
            >
              {data.net === 0 || data.target === null ? (
                <p className="muted">
                  Ainda não há referências suficientes para gerar a análise.
                </p>
              ) : (
                <>
                  <ol className="priority-list">
                    {priorities.map((row, i) => (
                      <li key={row.key}>
                        <span className="priority-number">{i + 1}</span>
                        <div>
                          <strong>{row.group}</strong>
                          <span className="muted small">
                            {row.store} ·{" "}
                            {money(Math.max(0, (row.target ?? 0) - row.net))}{" "}
                            para atingir a meta
                          </span>
                        </div>
                        <Badge tone="warning">Acompanhar</Badge>
                      </li>
                    ))}
                  </ol>
                  <Link
                    className="inline-link"
                    to="/minhas-metas"
                    search={{ ...filters, ...range }}
                  >
                    Ver minhas metas <Icon name="arrow" size={16} />
                  </Link>
                </>
              )}
            </Panel>
          </div>
          <Panel
            title="Desempenho no ano"
            subtitle="Janeiro até o mês de referência · meses futuros sem base"
            action={
              <label className="inline-label">
                Indicador
                <select
                  aria-label="Indicador do gráfico"
                  value={filters.metric}
                  onChange={(e) => update({ metric: e.target.value as Metric })}
                >
                  <option value="net">Venda líquida</option>
                  <option value="coupons">Clientes atendidos</option>
                  <option value="ticket">Ticket médio</option>
                </select>
              </label>
            }
          >
            <div className="annual-stats">
              <div>
                <span>
                  {filters.metric === "ticket" ? "Ticket no ano" : "Acumulado"}
                </span>
                <strong>{metricValue(annualValue, filters.metric)}</strong>
              </div>
              <div>
                <span>Média mensal</span>
                <strong>{metricValue(average, filters.metric)}</strong>
              </div>
              <div>
                <span>Melhor mês</span>
                <strong>
                  {best
                    ? `${best.label} · ${metricValue(best.value, filters.metric)}`
                    : "Sem base"}
                </strong>
              </div>
            </div>
            <LineChart
              data={points}
              label={`${indicator} por mês em ${filters.year}. Tabela alternativa a seguir.`}
              theme={theme}
              currency={filters.metric !== "coupons"}
            />
            <details className="data-alternative">
              <summary>Ver dados do gráfico em tabela</summary>
              <div className="table-scroll">
                <table>
                  <caption>
                    {indicator} por mês · {filters.year} · dados fictícios
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Mês</th>
                      <th scope="col">{indicator}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.label}>
                        <th scope="row">{point.label}</th>
                        <td>{metricValue(point.value, filters.metric)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Panel>
          <Panel
            title="Eu × Loja"
            subtitle="Mesma filial e mesmo período · prévia de design, permissões pendentes"
          >
            {data.net === 0 ? (
              <EmptyState title="Sem dados para comparar neste período." />
            ) : (
              <>
                <p className="comparison-note">
                  Comparativo fictício para avaliação visual. Não representa
                  acesso autorizado ao total mensal da loja.
                </p>
                <div className="table-scroll">
                  <table aria-label="Comparativo fictício Eu e Loja">
                    <thead>
                      <tr>
                        <th scope="col">Indicador</th>
                        <th scope="col">Eu</th>
                        <th scope="col">Loja</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Venda líquida</th>
                        <td>{money(data.net)}</td>
                        <td>{money(data.storeNet)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Clientes atendidos (cupons)</th>
                        <td>{number(data.coupons)}</td>
                        <td>{number(data.storeCoupons)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Ticket médio</th>
                        <td>
                          {data.coupons
                            ? money(data.net / data.coupons)
                            : "Sem base"}
                        </td>
                        <td>
                          {data.storeCoupons
                            ? money(data.storeNet / data.storeCoupons)
                            : "Sem base"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>
        </PageState>
      </main>
    </>
  );
}

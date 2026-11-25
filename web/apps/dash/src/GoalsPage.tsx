import { useEffect, useState } from "react";
import { Badge, EmptyState, Icon, KpiCard, Panel, Progress } from "@crmf/ui";
import { Donut } from "@crmf/charts";
import { useFilters } from "./filters";
import { useTheme } from "./DashboardShell";
import { PageState, useDemoRefresh } from "./PageState";
import {
  csvForRows,
  defaults,
  goalStatus,
  groups,
  money,
  percent,
  ratio,
  summarize,
  validDate,
  type GroupRow,
  type Summary,
} from "./demo/data";
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
function RowCells({
  row,
  data,
  total = false,
}: {
  row: GroupRow;
  data: Summary;
  total?: boolean;
}) {
  const projected =
    data.elapsed > 0 ? Math.round((row.net / data.elapsed) * data.days) : null;
  const status = goalStatus(row.net, row.target, data.elapsed, data.days);
  return (
    <>
      <th scope="row">{row.store}</th>
      <td>{total ? "—" : row.group}</td>
      <td>{row.target === null ? "Sem meta" : money(row.target)}</td>
      <td>{money(row.net)}</td>
      <td>{percent(ratio(row.net, data.net))}</td>
      <td>
        {row.target === null
          ? "Sem meta"
          : money(Math.max(0, row.target - row.net))}
      </td>
      <td>{percent(ratio(row.net, row.target))}</td>
      <td>{money(projected)}</td>
      <td>
        {percent(projected === null ? null : ratio(projected, row.target))}
      </td>
      <td>
        {row.target === null || data.remaining === 0
          ? "Sem base"
          : money(
              Math.round(Math.max(0, row.target - row.net) / data.remaining),
            )}
      </td>
      <td>
        <Badge tone={status.tone}>{status.text}</Badge>
      </td>
    </>
  );
}
export function GoalsPage() {
  const { filters, update } = useFilters();
  const theme = useTheme();
  const refresh = useDemoRefresh();
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{
    key: "group" | "target" | "net";
    descending: boolean;
  }>({ key: "group", descending: false });
  const [page, setPage] = useState(0);
  useEffect(() => {
    setFrom(filters.from);
    setTo(filters.to);
    setError("");
  }, [filters.from, filters.to]);
  const data = summarize(
    filters.store,
    filters.from,
    filters.to,
    filters.scenario,
  );
  const status = goalStatus(data.net, data.target, data.elapsed, data.days);
  const priorities =
    data.remaining > 0
      ? [...data.rows]
          .filter((row) => row.target !== null && row.target > row.net)
          .sort((a, b) => (b.target ?? 0) - b.net - ((a.target ?? 0) - a.net))
          .slice(0, 3)
      : [];
  const filtered = data.rows
    .filter((row) =>
      normalize(`${row.store} ${row.group}`).includes(normalize(search)),
    )
    .sort((a, b) => {
      const comparison =
        sort.key === "group"
          ? a.group.localeCompare(b.group, "pt-BR") ||
            a.store.localeCompare(b.store)
          : (a[sort.key] ?? 0) - (b[sort.key] ?? 0);
      return comparison * (sort.descending ? -1 : 1);
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 6));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * 6, currentPage * 6 + 6);
  const sum = (
    key: "net" | "coupons" | "loyalty" | "storeNet" | "storeCoupons",
  ) => filtered.reduce((total, row) => total + row[key], 0);
  const totalRow: GroupRow = {
    key: "total",
    group: "",
    store: search ? "Total filtrado" : "Total",
    net: sum("net"),
    coupons: sum("coupons"),
    loyalty: sum("loyalty"),
    storeNet: sum("storeNet"),
    storeCoupons: sum("storeCoupons"),
    target:
      data.target === null
        ? null
        : filtered.reduce((total, row) => total + (row.target ?? 0), 0),
    cost: null,
  };
  const mix = groups.map((group) => ({
    label: group,
    value:
      data.rows
        .filter((row) => row.group === group)
        .reduce((total, row) => total + row.net, 0) / 100,
  }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validDate(from) || !validDate(to)) {
      setError("Informe datas válidas entre 2025 e 2026.");
      return;
    }
    if (from > to) {
      setError("A data inicial não pode ser posterior à data final.");
      return;
    }
    setError("");
    setPage(0);
    update({ from, to });
  };
  const reset = () => {
    setFrom(defaults.from);
    setTo(defaults.to);
    setSearch("");
    setPage(0);
    setError("");
    update({ from: defaults.from, to: defaults.to });
  };
  const changeSort = (key: typeof sort.key) => {
    setSort({ key, descending: sort.key === key ? !sort.descending : false });
    setPage(0);
  };
  const exportCSV = () => {
    const blob = new Blob([csvForRows(filtered)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `metas-demo-${filters.store}-${filters.from}-${filters.to}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <nav className="breadcrumb" aria-label="Trilha">
            CRM Farma › Metas
          </nav>
          <h1 id="page-title">Minhas metas</h1>
        </div>
        <form className="filters-row goals-filters" onSubmit={submit}>
          <label>
            Data inicial
            <input
              type="date"
              value={from}
              min="2025-01-01"
              max="2026-12-31"
              required
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Data final
            <input
              type="date"
              value={to}
              min="2025-01-01"
              max="2026-12-31"
              required
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            className="button"
            type="button"
            title="Mês da referência fictícia: novembro de 2026"
            onClick={reset}
          >
            Mês atual
          </button>
          <button
            className="button button--ghost"
            type="button"
            onClick={reset}
          >
            Limpar filtros
          </button>
          <button className="button button--primary" type="submit">
            <Icon name="search" size={16} />
            Buscar
          </button>
        </form>
      </div>
      <main
        id="main-content"
        className="page-content"
        aria-labelledby="page-title"
        tabIndex={-1}
      >
        {error && (
          <div className="alert alert--error" role="alert">
            <Icon name="alert" />
            {error}
          </div>
        )}
        <PageState busy={refresh.busy} retry={() => refresh.refresh(true)}>
          <section className="today-plan" aria-label="Plano de hoje">
            <div className="plan-intro">
              <span className="eyebrow">
                Plano de hoje · dia {data.elapsed} de {data.days}
              </span>
              <strong>
                {data.target === null
                  ? "Ainda não existe meta cadastrada para este período"
                  : data.remaining === 0
                    ? "Período encerrado: confira seu resultado"
                    : data.elapsed === 0
                      ? "O período ainda não começou"
                      : "Seu próximo passo para alcançar a meta"}
              </strong>
              <span className="plan-status">
                <Badge tone={status.tone}>{status.text}</Badge>
                <span className="muted small">
                  Projeção de{" "}
                  {percent(
                    data.projected === null
                      ? null
                      : ratio(data.projected, data.target),
                  )}
                </span>
              </span>
            </div>
            <div className="plan-stat">
              <span className="eyebrow">Precisa vender/dia</span>
              <strong>
                {data.target === null ? "Sem meta" : money(data.needed)}
              </strong>
              <span className="muted small">
                {data.remaining > 0
                  ? `por ${data.remaining} dias restantes`
                  : "Período encerrado"}
              </span>
            </div>
            <div className="plan-stat">
              <span className="eyebrow">Média atual/dia</span>
              <strong>{money(data.average)}</strong>
              <span className="muted small">no período corrido</span>
            </div>
            <div className="plan-stat">
              <span className="eyebrow">Ação nº 1</span>
              <strong className="plan-action">
                {priorities[0]?.group ?? "Sem prioridade"}
              </strong>
              <span className="muted small">
                {priorities[0]?.store ?? "Nenhuma necessidade diária"}
              </span>
            </div>
          </section>
          <div className="kpi-grid goals-kpis">
            <KpiCard
              label="Meta fixa"
              value={data.target === null ? "Sem meta" : money(data.target)}
            />
            <KpiCard label="Total vendas" value={money(data.net)} />
            <KpiCard
              label="Meta atingida"
              value={percent(ratio(data.net, data.target))}
            />
            <KpiCard
              label="Falta"
              value={
                data.target === null
                  ? "Sem meta"
                  : money(Math.max(0, data.target - data.net))
              }
            />
            <KpiCard label="Projeção líquida" value={money(data.projected)} />
            <KpiCard
              label="Projeção percentual"
              value={percent(
                data.projected === null
                  ? null
                  : ratio(data.projected, data.target),
              )}
            />
          </div>
          <div className="two-columns">
            <Panel
              title="Realizado × ritmo ideal"
              subtitle={`Comparação acumulada no ciclo de ${data.days} dias`}
              action={<Badge tone={status.tone}>{status.text}</Badge>}
            >
              <div className="rhythm-content">
                <Progress
                  label="Realizado"
                  value={ratio(data.net, data.target)}
                />
                <Progress
                  label="Esperado até hoje"
                  value={
                    data.target === null || data.days === 0
                      ? null
                      : (data.elapsed / data.days) * 100
                  }
                  muted
                />
                <div className="rhythm-totals">
                  <div>
                    <span className="eyebrow">Ideal até hoje</span>
                    <strong>
                      {data.target === null
                        ? "Sem meta"
                        : money(
                            Math.round(
                              (data.target * data.elapsed) / data.days,
                            ),
                          )}
                    </strong>
                  </div>
                  <div>
                    <span className="eyebrow">Diferença do ritmo</span>
                    <strong
                      className={
                        data.target !== null &&
                        data.net < (data.target * data.elapsed) / data.days
                          ? "warning"
                          : "positive"
                      }
                    >
                      {data.target === null
                        ? "Sem base"
                        : money(
                            data.net -
                              Math.round(
                                (data.target * data.elapsed) / data.days,
                              ),
                          )}
                    </strong>
                  </div>
                </div>
              </div>
            </Panel>
            <Panel
              title="Prioridades de hoje"
              subtitle="Grupos com maior necessidade diária"
            >
              {priorities.length === 0 ? (
                <p className="muted">Nenhum grupo exige ação neste momento.</p>
              ) : (
                <ol className="priority-list">
                  {priorities.map((row, i) => (
                    <li key={row.key}>
                      <span className="priority-number">{i + 1}</span>
                      <div>
                        <strong>{row.group}</strong>
                        <span className="muted small">{row.store}</span>
                      </div>
                      <div className="priority-amount">
                        <strong>
                          {money(
                            Math.round(
                              ((row.target ?? 0) - row.net) / data.remaining,
                            ),
                          )}
                        </strong>
                        <span className="muted small">necessário/dia</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>
          <Panel
            title="Distribuição de vendas"
            subtitle="Participação de cada grupo no período"
          >
            {data.net === 0 ? (
              <EmptyState title="Sem vendas no período">
                A distribuição aparece quando houver vendas registradas.
              </EmptyState>
            ) : (
              <>
                <Donut
                  data={mix}
                  label="Distribuição de vendas por grupo. Tabela alternativa a seguir."
                  theme={theme}
                />
                <details className="data-alternative">
                  <summary>Ver distribuição em tabela</summary>
                  <div className="table-scroll">
                    <table>
                      <caption>Vendas fictícias por grupo</caption>
                      <thead>
                        <tr>
                          <th scope="col">Grupo</th>
                          <th scope="col">Líquido</th>
                          <th scope="col">Participação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mix.map((row) => (
                          <tr key={row.label}>
                            <th scope="row">{row.label}</th>
                            <td>{money(row.value * 100)}</td>
                            <td>{percent(ratio(row.value * 100, data.net))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </Panel>
          <Panel
            className="goals-table-panel"
            title="Vendedor"
            subtitle="Pericles · por filial e grupo · metas inteiramente fictícias"
            action={
              <div className="table-actions">
                <div className="input-icon">
                  <Icon name="search" size={16} />
                  <label className="sr-only" htmlFor="table-search">
                    Buscar na tabela
                  </label>
                  <input
                    id="table-search"
                    type="search"
                    placeholder="Buscar…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <button
                  className="button"
                  onClick={exportCSV}
                  disabled={filtered.length === 0}
                >
                  <Icon name="download" size={16} />
                  Exportar CSV
                </button>
              </div>
            }
          >
            <p className="comparison-note">
              Metas por vendedor/grupo apenas para prévia visual; não são as
              metas mensais por loja da spec. Valores proporcionais aos dias
              corridos, só nesta simulação.
            </p>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Tabela de metas, role horizontalmente para mais colunas"
            >
              <table className="goals-table">
                <caption className="sr-only">
                  Metas por vendedor — dados fictícios
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Filial</th>
                    <th
                      scope="col"
                      aria-sort={
                        sort.key === "group"
                          ? sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button onClick={() => changeSort("group")}>
                        Grupo ↕
                      </button>
                    </th>
                    <th
                      scope="col"
                      aria-sort={
                        sort.key === "target"
                          ? sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button onClick={() => changeSort("target")}>
                        Meta ↕
                      </button>
                    </th>
                    <th
                      scope="col"
                      aria-sort={
                        sort.key === "net"
                          ? sort.descending
                            ? "descending"
                            : "ascending"
                          : "none"
                      }
                    >
                      <button onClick={() => changeSort("net")}>
                        Líquido ↕
                      </button>
                    </th>
                    {[
                      "Participação",
                      "Meta a atingir",
                      "Realizado",
                      "Projeção líq.",
                      "Projeção %",
                      "R$/dia necessário",
                      "Status",
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="total-row">
                    <RowCells row={totalRow} data={data} total />
                  </tr>
                  {pageRows.map((row) => (
                    <tr key={row.key}>
                      <RowCells row={row} data={data} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <p className="empty-table">
                Nenhum grupo encontrado para essa busca.
              </p>
            )}
            <div className="table-footer">
              <span>
                {filtered.length === 0
                  ? "0 registros"
                  : `${currentPage * 6 + 1}–${Math.min((currentPage + 1) * 6, filtered.length)} de ${filtered.length} registros`}
                {search && " · total de todos os resultados filtrados"}
              </span>
              <div>
                <button
                  className="button button--small"
                  aria-label="Página anterior"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </button>
                <span>
                  {currentPage + 1} / {pageCount}
                </span>
                <button
                  className="button button--small"
                  aria-label="Próxima página"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Próxima
                </button>
              </div>
            </div>
          </Panel>
        </PageState>
      </main>
    </>
  );
}

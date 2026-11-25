import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { createDashRouter } from "./App";
import {
  annualSeries,
  csvForRows,
  defaults,
  goalStatus,
  money,
  parseFilters,
  ratio,
  summarize,
  validDate,
} from "./demo/data";
vi.mock("@crmf/charts", () => ({
  LineChart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
  Donut: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}));
beforeEach(() => localStorage.clear());
async function open(path = "/meu-desempenho") {
  const router = createDashRouter(
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", {
    name: path.includes("minhas-metas") ? "Minhas metas" : "Meu desempenho",
  });
  return router;
}
test("renders a clearly labeled synthetic dashboard and accessible chart alternative", async () => {
  await open();
  expect(screen.getByText("Demonstração", { exact: true })).toBeVisible();
  expect(screen.getByText(/sem conexão com ERP/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "Leitura do mês" })).toBeVisible();
  expect(
    screen.getByRole("img", { name: /Venda líquida por mês/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Ver dados do gráfico em tabela"),
  ).toBeInTheDocument();
});
test("routes preserve filters and store selection changes the URL", async () => {
  const router = await open();
  fireEvent.click(screen.getByRole("button", { name: "Minhas lojas" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Minhas lojas" })).getByRole(
      "button",
      { name: /HIPER904/ },
    ),
  );
  await waitFor(() => expect(router.state.location.search.store).toBe("904"));
  fireEvent.click(screen.getByRole("link", { name: "Minhas metas" }));
  await screen.findByRole("heading", { name: "Minhas metas" });
  expect(router.state.location.search.store).toBe("904");
  expect(
    screen.getByRole("table", { name: /Metas por vendedor/ }),
  ).toBeInTheDocument();
});
test("theme switching is persisted and sidebar can collapse", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Usar tema claro" }));
  expect(document.querySelector(".dashboard")).toHaveAttribute(
    "data-theme",
    "light",
  );
  expect(localStorage.getItem("crmf-demo-theme")).toBe("light");
  fireEvent.click(
    screen.getByRole("button", { name: "Recolher menu lateral" }),
  );
  expect(
    screen.getByRole("button", { name: "Expandir menu lateral" }),
  ).toHaveAttribute("aria-expanded", "false");
});
test("empty and missing-base states never invent ratios", async () => {
  await open("/meu-desempenho?scenario=empty");
  expect(
    screen.getByText("Não há vendas registradas para este período."),
  ).toBeVisible();
  expect(screen.getAllByText("Sem base").length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});
test("simulated failure can retry locally and does not render misleading zero KPIs", async () => {
  const router = await open("/meu-desempenho?scenario=error");
  expect(screen.getByRole("alert")).toHaveTextContent("Erro simulado");
  expect(
    screen.queryByText("Venda líquida", { exact: true }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Carregando demonstração",
  );
  await waitFor(() =>
    expect(router.state.location.search.scenario).toBe("populated"),
  );
  await screen.findByRole("heading", { name: "Leitura do mês" });
});
test("goals filters validate reversed dates and support filtered totals", async () => {
  await open("/minhas-metas");
  fireEvent.change(screen.getByLabelText("Data inicial"), {
    target: { value: "2026-11-30" },
  });
  fireEvent.change(screen.getByLabelText("Data final"), {
    target: { value: "2026-11-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "data inicial não pode ser posterior",
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Buscar na tabela" }),
    { target: { value: "genericos" } },
  );
  const table = screen.getByRole("table", { name: /Metas por vendedor/ });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(
    within(table).getByRole("rowheader", { name: "Total filtrado" }),
  ).toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Buscar na tabela" }),
    { target: { value: "inexistente" } },
  );
  expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeDisabled();
  expect(
    screen.getByText("Nenhum grupo encontrado para essa busca."),
  ).toBeVisible();
});
test("synthetic totals are deterministic and all stores equal the sum of both stores", () => {
  const first = summarize("331", defaults.from, defaults.to, "populated");
  const second = summarize("904", defaults.from, defaults.to, "populated");
  const all = summarize("all", defaults.from, defaults.to, "populated");
  expect(first).toEqual(
    summarize("331", defaults.from, defaults.to, "populated"),
  );
  expect(all.net).toBe(first.net + second.net);
  expect(all.coupons).toBe(first.coupons + second.coupons);
  expect(all.target).toBe((first.target ?? 0) + (second.target ?? 0));
  expect(first.elapsed).toBe(25);
  expect(first.remaining).toBe(5);
  expect(first.projected).toBe(Math.round((first.net / 25) * 30));
});
test("zero denominators, invalid query strings, future dates and missing coverage are safe", () => {
  expect(ratio(0, 0)).toBeNull();
  expect(ratio(10, null)).toBeNull();
  expect(validDate("2026-02-31")).toBe(false);
  expect(
    parseFilters({
      store: "other",
      scenario: "__proto__",
      month: 99,
      year: "evil",
    }),
  ).toEqual(defaults);
  const missing = summarize("331", defaults.from, defaults.to, "no-base");
  expect(missing.cost).toBeNull();
  expect(missing.target).toBeNull();
  expect(goalStatus(missing.net, missing.target, 25, 30).text).toBe("Sem meta");
  const future = summarize("331", "2026-12-01", "2026-12-31", "populated");
  expect(future.net).toBe(0);
  expect(future.elapsed).toBe(0);
  expect(future.projected).toBeNull();
  expect(money(null)).toBe("Sem base");
  expect(annualSeries(defaults)[11].value).toBeNull();
});
test("cross-month and closed periods are supported without a remaining-day division by zero", () => {
  const cross = summarize("all", "2026-10-20", "2026-11-10", "populated");
  expect(cross.days).toBe(22);
  expect(cross.elapsed).toBe(22);
  expect(cross.remaining).toBe(0);
  expect(cross.needed).toBeNull();
  expect(cross.projected).toBe(cross.net);
});
test("CSV contains only the selected synthetic rows and escapes spreadsheet formulas", () => {
  const data = summarize("331", defaults.from, defaults.to, "populated");
  const csv = csvForRows([{ ...data.rows[0], group: '=SUM(A1);"teste"' }]);
  expect(csv).toContain('"\'=SUM(A1);""teste"""');
  expect(csv).toContain("HIPER 331");
  expect(csv).not.toContain("HIPER904");
  expect(csv.split("\r\n")).toHaveLength(2);
});

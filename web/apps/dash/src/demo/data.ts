// Synthetic, deterministic aggregates only. Never read from the ERP or API.
export const DEMO_TODAY = "2026-11-25";
export const stores = [
  { id: "all", name: "Todas as lojas", description: "2 lojas de demonstração" },
  { id: "331", name: "HIPER 331", description: "PIRIQUI · demonstração" },
  { id: "904", name: "HIPER904", description: "ESTADOS UNIDOS · demonstração" },
] as const;
export const scenarios = {
  populated: "Com dados",
  empty: "Sem vendas",
  "no-base": "Sem base / sem meta",
  error: "Erro",
  loading: "Carregando",
} as const;
export type Scenario = keyof typeof scenarios;
export type StoreId = (typeof stores)[number]["id"];
export type Metric = "net" | "coupons" | "ticket";
export interface Filters {
  store: StoreId;
  scenario: Scenario;
  month: number;
  year: number;
  from: string;
  to: string;
  metric: Metric;
}
export const defaults: Filters = {
  store: "331",
  scenario: "populated",
  month: 11,
  year: 2026,
  from: "2026-11-01",
  to: "2026-11-30",
  metric: "net",
};
const DAY = 86400000;
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^202[56]-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parseFilters(raw: Record<string, unknown>): Filters {
  return {
    store: stores.find((s) => s.id === raw.store)?.id ?? defaults.store,
    scenario:
      typeof raw.scenario === "string" && Object.hasOwn(scenarios, raw.scenario)
        ? (raw.scenario as Scenario)
        : defaults.scenario,
    month:
      Number.isInteger(Number(raw.month)) &&
      Number(raw.month) >= 1 &&
      Number(raw.month) <= 12
        ? Number(raw.month)
        : defaults.month,
    year: Number(raw.year) === 2025 ? 2025 : 2026,
    from: validDate(raw.from) ? raw.from : defaults.from,
    to: validDate(raw.to) ? raw.to : defaults.to,
    metric:
      raw.metric === "coupons" || raw.metric === "ticket" ? raw.metric : "net",
  };
}
export function monthRange(year: number, month: number) {
  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}
export function daysBetween(from: string, to: string) {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1);
}
export const money = (cents: number | null) =>
  cents === null
    ? "Sem base"
    : (cents / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
export const number = (value: number) => value.toLocaleString("pt-BR");
export const percent = (value: number | null) =>
  value === null
    ? "Sem base"
    : `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const ratio = (value: number, base: number | null) =>
  base !== null && base > 0 ? (value / base) * 100 : null;
export const groups = [
  "Genéricos",
  "Referência",
  "Similares",
  "Higiene e beleza",
  "Perfumaria",
  "Outros",
];
const weights = [30, 23, 18, 13, 10, 6];
export interface GroupRow {
  key: string;
  store: string;
  group: string;
  net: number;
  cost: number | null;
  coupons: number;
  loyalty: number;
  target: number | null;
  storeNet: number;
  storeCoupons: number;
}
export interface Summary {
  rows: GroupRow[];
  net: number;
  cost: number | null;
  coupons: number;
  loyalty: number | null;
  target: number | null;
  storeNet: number;
  storeCoupons: number;
  elapsed: number;
  days: number;
  remaining: number;
  projected: number | null;
  needed: number | null;
  average: number | null;
}
export function summarize(
  store: StoreId,
  from: string,
  to: string,
  scenario: Scenario,
): Summary {
  const days = daysBetween(from, to);
  const elapsed = daysBetween(from, to < DEMO_TODAY ? to : DEMO_TODAY);
  const unavailable = scenario === "no-base" || scenario === "empty";
  const rows: GroupRow[] = [];
  for (const shop of stores.filter(
    (s) => s.id !== "all" && (store === "all" || s.id === store),
  )) {
    groups.forEach((group, i) => {
      let net = 0,
        target = 0,
        coupons = 0,
        cost = 0,
        loyalty = 0,
        storeNet = 0,
        storeCoupons = 0;
      for (let time = Date.parse(from); time <= Date.parse(to); time += DAY) {
        const date = new Date(time);
        const day = date.toISOString().slice(0, 10);
        const monthDays = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
        ).getUTCDate();
        target += Math.round(
          ((shop.id === "331" ? 8400000 : 6300000) * weights[i]) /
            100 /
            monthDays,
        );
        if (day > DEMO_TODAY || scenario === "empty") continue;
        const seed =
          date.getUTCDate() * 13 +
          date.getUTCMonth() * 7 +
          i * 11 +
          (shop.id === "331" ? 1 : 9);
        const count = 3 + (seed % 7);
        const amount = count * (1800 + i * 510 + (seed % 1300));
        net += amount;
        coupons += count;
        cost += Math.round(amount * (0.54 + i * 0.025));
        loyalty += Math.round(amount * (0.39 + (seed % 20) / 100));
        storeNet += amount * (4 + (seed % 2));
        storeCoupons += count * (4 + (seed % 2));
      }
      rows.push({
        key: `${shop.id}-${i}`,
        store: shop.name,
        group,
        net,
        cost: unavailable ? null : cost,
        coupons,
        loyalty,
        target: unavailable ? null : target,
        storeNet,
        storeCoupons,
      });
    });
  }
  const sum = (
    key: "net" | "coupons" | "loyalty" | "storeNet" | "storeCoupons",
  ) => rows.reduce((total, row) => total + row[key], 0);
  const net = sum("net");
  const target = unavailable
    ? null
    : rows.reduce((total, row) => total + (row.target ?? 0), 0);
  const remaining = Math.max(0, days - elapsed);
  return {
    rows,
    net,
    target,
    cost: unavailable
      ? null
      : rows.reduce((total, row) => total + (row.cost ?? 0), 0),
    coupons: sum("coupons"),
    loyalty: scenario === "no-base" ? null : sum("loyalty"),
    storeNet: sum("storeNet"),
    storeCoupons: sum("storeCoupons"),
    days,
    elapsed,
    remaining,
    projected: elapsed > 0 ? Math.round((net / elapsed) * days) : null,
    needed:
      target === null || remaining === 0
        ? null
        : Math.round(Math.max(0, target - net) / remaining),
    average: elapsed > 0 ? Math.round(net / elapsed) : null,
  };
}
export function annualSeries(filters: Filters) {
  return Array.from({ length: 12 }, (_, index) => {
    const range = monthRange(filters.year, index + 1);
    const data = summarize(
      filters.store,
      range.from,
      range.to,
      filters.scenario,
    );
    return {
      label: new Date(Date.UTC(filters.year, index, 1))
        .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
        .replace(".", ""),
      value:
        range.from > DEMO_TODAY
          ? null
          : filters.metric === "coupons"
            ? data.coupons
            : filters.metric === "ticket"
              ? data.coupons > 0
                ? data.net / data.coupons / 100
                : null
              : data.net / 100,
    };
  });
}
export function metricValue(value: number | null, metric: Metric) {
  return value === null
    ? "Sem base"
    : metric === "coupons"
      ? number(value)
      : money(value * 100);
}
export function goalStatus(
  net: number,
  target: number | null,
  elapsed: number,
  days: number,
) {
  if (target === null || target <= 0)
    return { text: "Sem meta", tone: "neutral" as const };
  if (elapsed === 0) return { text: "A iniciar", tone: "neutral" as const };
  if (net >= target) return { text: "Atingida", tone: "success" as const };
  return net >= (target * elapsed) / days
    ? { text: "No ritmo", tone: "success" as const }
    : { text: "Atenção", tone: "warning" as const };
}
export function csvForRows(rows: GroupRow[]) {
  // Quote every field and neutralize formula prefixes, including future fixture edits.
  const cell = (value: string | number) =>
    `"${String(value)
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      ["Filial", "Grupo", "Meta (R$)", "Líquido (R$)", "Cupons"],
      ...rows.map((r) => [
        r.store,
        r.group,
        r.target === null
          ? "Sem meta"
          : (r.target / 100).toFixed(2).replace(".", ","),
        (r.net / 100).toFixed(2).replace(".", ","),
        r.coupons,
      ]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}

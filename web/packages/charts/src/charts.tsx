import { lazy, Suspense } from "react";
import type { EChartsOption } from "echarts";
const Canvas = lazy(() => import("./ChartCanvas"));
const palette = [
  "#4c8be8",
  "#2fb344",
  "#f59f00",
  "#ae3ec9",
  "#2fb3a4",
  "#d6336c",
];
interface Point {
  label: string;
  value: number | null;
}
interface Props {
  data: Point[];
  label: string;
  currency?: boolean;
  theme: "dark" | "light";
}
const format = (value: number, currency: boolean) =>
  value.toLocaleString("pt-BR", {
    style: currency ? "currency" : "decimal",
    currency: currency ? "BRL" : undefined,
    maximumFractionDigits: currency ? 2 : 0,
  });
function Chart({ option, label }: { option: EChartsOption; label: string }) {
  return (
    <div className="chart" role="img" aria-label={label}>
      <Suspense fallback={<p role="status">Preparando gráfico…</p>}>
        <Canvas option={option} />
      </Suspense>
    </div>
  );
}
function base(theme: Props["theme"]): EChartsOption {
  return {
    animation: false,
    color: palette,
    textStyle: {
      fontFamily: "system-ui, sans-serif",
      color: theme === "dark" ? "#a3a3a3" : "#737373",
    },
    aria: { enabled: true },
    grid: { top: 24, right: 24, bottom: 30, left: 80 },
  };
}
export function LineChart({ data, label, currency = true, theme }: Props) {
  const color = theme === "dark" ? "#2dd4bf" : "#0f766e";
  return (
    <Chart
      label={label}
      option={{
        ...base(theme),
        tooltip: {
          trigger: "axis",
          valueFormatter: (value) =>
            typeof value === "number" ? format(value, currency) : "Sem base",
        },
        xAxis: {
          type: "category",
          data: data.map((p) => p.label),
          axisTick: { show: false },
          axisLabel: { color: theme === "dark" ? "#a3a3a3" : "#737373" },
        },
        yAxis: {
          type: "value",
          axisLabel: {
            color: theme === "dark" ? "#a3a3a3" : "#737373",
            formatter: (v: number) =>
              currency
                ? `R$ ${v >= 1000 ? (v / 1000).toLocaleString("pt-BR") + " mil" : v.toLocaleString("pt-BR")}`
                : v.toLocaleString("pt-BR"),
          },
          splitLine: {
            lineStyle: { color: theme === "dark" ? "#333333" : "#f0f0f0" },
          },
        },
        series: [
          {
            type: "line",
            data: data.map((p) => p.value),
            smooth: false,
            symbolSize: 7,
            connectNulls: false,
            itemStyle: { color },
            lineStyle: { width: 3 },
            areaStyle: { color, opacity: 0.07 },
          },
        ],
      }}
    />
  );
}
export function BarChart({ data, label, currency = true, theme }: Props) {
  return (
    <Chart
      label={label}
      option={{
        ...base(theme),
        tooltip: {
          trigger: "axis",
          valueFormatter: (v) =>
            typeof v === "number" ? format(v, currency) : "Sem base",
        },
        xAxis: { type: "category", data: data.map((p) => p.label) },
        yAxis: { type: "value" },
        series: [
          {
            type: "bar",
            data: data.map((p, i) => ({
              value: p.value,
              itemStyle: { color: palette[i % palette.length] },
            })),
          },
        ],
      }}
    />
  );
}
export function Donut({ data, label, currency = true, theme }: Props) {
  if (data.length > 6) throw new Error("Donut supports at most six groups.");
  return (
    <Chart
      label={label}
      option={{
        ...base(theme),
        tooltip: {
          trigger: "item",
          valueFormatter: (v) =>
            typeof v === "number" ? format(v, currency) : "Sem base",
        },
        legend: {
          orient: "vertical",
          right: "5%",
          top: "middle",
          textStyle: { color: theme === "dark" ? "#e5e5e5" : "#404040" },
        },
        series: [
          {
            type: "pie",
            radius: ["48%", "74%"],
            center: ["30%", "50%"],
            label: { show: false },
            data: data.map((p) => ({ name: p.label, value: p.value ?? 0 })),
          },
        ],
        media: [
          {
            query: { maxWidth: 400 },
            option: {
              legend: {
                orient: "horizontal",
                left: "center",
                right: "auto",
                top: "auto",
                bottom: 0,
              },
              series: [{ center: ["50%", "40%"], radius: ["40%", "65%"] }],
            },
          },
        ],
      }}
    />
  );
}

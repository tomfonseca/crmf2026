import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { LineChart, BarChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  SVGRenderer,
]);
export default function ChartCanvas({ option }: { option: EChartsOption }) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      opts={{ renderer: "svg" }}
      style={{ height: 250, width: "100%" }}
    />
  );
}

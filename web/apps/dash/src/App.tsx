import { useState } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { DashboardShell } from "./DashboardShell";
import { PerformancePage } from "./PerformancePage";
import { GoalsPage } from "./GoalsPage";
import { parseFilters } from "./demo/data";
import "@crmf/ui/styles.css";
import "./dashboard.css";

const rootRoute = createRootRoute({
  component: DashboardShell,
  validateSearch: parseFilters,
  notFoundComponent: () => (
    <div className="empty-state">
      <h1>Página não encontrada</h1>
      <a href="/meu-desempenho">Voltar ao dashboard</a>
    </div>
  ),
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/meu-desempenho", search });
  },
});
const performanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/meu-desempenho",
  component: PerformancePage,
});
const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/minhas-metas",
  component: GoalsPage,
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  performanceRoute,
  goalsRoute,
]);
export function createDashRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: "intent" });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createDashRouter>;
  }
}
export function App() {
  const [router] = useState(() => createDashRouter());
  return <RouterProvider router={router} />;
}

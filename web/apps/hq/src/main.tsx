import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { App } from "./App";
const routeTree = createRootRoute({ component: App });
const router = createRouter({ routeTree });
const queryClient = new QueryClient();
const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { LoginPage } from "./LoginPage";
const queryClient = new QueryClient();
const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {window.location.pathname.replace(/\/+$/, "") === "/login" ? (
        <LoginPage />
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </React.StrictMode>,
);

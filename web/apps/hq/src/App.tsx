import { useCallback, useState } from "react";
import { AuthPortal, createAuthClient } from "@crmf/auth";
import { CatalogHost } from "./Plans";
import { createPlanClient } from "./plans-client";
import { createNetworkClient } from "./networks-client";

function configuredClients() {
  try {
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
    return {
      auth: createAuthClient(base, "platform", import.meta.env.DEV),
      plans: createPlanClient(base, import.meta.env.DEV),
      networks: createNetworkClient(base, import.meta.env.DEV),
    };
  } catch {
    return null;
  }
}
const clients = configuredClients();
export function App() {
  const [epoch, setEpoch] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const expire = useCallback(() => setEpoch((value) => value + 1), []);
  return clients ? (
    <AuthPortal key={epoch} client={clients.auth} title="QG CRMF" theme={theme}>
      <CatalogHost
        client={clients.plans}
        networks={clients.networks}
        onExpired={expire}
        theme={theme}
        toggleTheme={() =>
          setTheme((value) => (value === "dark" ? "light" : "dark"))
        }
      />
    </AuthPortal>
  ) : (
    <main>
      <h1>QG CRMF</h1>
      <p role="alert">
        Configure um endereço HTTPS válido para a API de autenticação.
      </p>
    </main>
  );
}

import { useCallback, useState } from "react";
import {
  AuthPortal,
  AuthDesignPreview,
  createAuthClient,
  useAuthTheme,
} from "@crmf/auth";
import { CatalogHost } from "./Plans";
import { createPlanClient } from "./plans-client";
import { createNetworkClient } from "./networks-client";
import { createStoreClient } from "./stores-client";
import { QGPreview } from "./QGPreview";

function configuredClients() {
  try {
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";
    return {
      auth: createAuthClient(base, "platform", import.meta.env.DEV),
      plans: createPlanClient(base, import.meta.env.DEV),
      networks: createNetworkClient(base, import.meta.env.DEV),
      stores: createStoreClient(base, import.meta.env.DEV),
    };
  } catch {
    return null;
  }
}
const clients = configuredClients();
export function App() {
  const [epoch, setEpoch] = useState(0);
  const [theme, toggleTheme] = useAuthTheme();
  const expire = useCallback(() => setEpoch((value) => value + 1), []);
  if (import.meta.env.DEV && window.location.pathname === "/__auth-design")
    return <AuthDesignPreview />;
  if (import.meta.env.DEV && window.location.pathname === "/__qg-design")
    return <QGPreview />;
  return clients ? (
    <AuthPortal
      key={epoch}
      client={clients.auth}
      realm="platform"
      title="QG CRMF"
      theme={theme}
      onThemeChange={toggleTheme}
      renderWorkspace={(actions) => (
        <CatalogHost
          client={clients.plans}
          networks={clients.networks}
          stores={clients.stores}
          onExpired={expire}
          theme={theme}
          toggleTheme={toggleTheme}
          actions={actions}
        />
      )}
    />
  ) : (
    <main>
      <h1>QG CRMF</h1>
      <p role="alert">
        Configure um endereço HTTPS válido para a API de autenticação.
      </p>
    </main>
  );
}

import { AuthPortal, createAuthClient } from "@crmf/auth";

function configuredClient() {
  try {
    return createAuthClient(
      import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080",
      "platform",
      import.meta.env.DEV,
    );
  } catch {
    return null;
  }
}
const client = configuredClient();
export function App() {
  return client ? (
    <AuthPortal client={client} title="QG CRMF" />
  ) : (
    <main>
      <h1>QG CRMF</h1>
      <p role="alert">
        Configure um endereço HTTPS válido para a API de autenticação.
      </p>
    </main>
  );
}

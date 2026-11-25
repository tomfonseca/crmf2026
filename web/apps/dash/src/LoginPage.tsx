import { AuthPortal, createAuthClient } from "@crmf/auth";

function configuredClient() {
  try {
    return createAuthClient(
      import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080",
      "tenant",
      import.meta.env.DEV,
    );
  } catch {
    return null;
  }
}
const client = configuredClient();
export function LoginPage() {
  return client ? (
    <AuthPortal client={client} title="Acesso CRMF">
      <p>
        Seu acesso foi verificado. Os indicadores reais ainda não estão
        disponíveis.
      </p>
      <p>A prévia de demonstração é separada e usa somente dados sintéticos.</p>
    </AuthPortal>
  ) : (
    <main>
      <h1>Acesso CRMF</h1>
      <p role="alert">
        Configure um endereço HTTPS válido para a API de autenticação.
      </p>
    </main>
  );
}

import { createAppClient, type AppComponents } from "@crmf/api-client";
import { createAuthClient } from "@crmf/auth";
export type Network = AppComponents["schemas"]["Network"];
export type NetworkInput = AppComponents["schemas"]["NetworkInput"];
export type NetworkProfileInput =
  AppComponents["schemas"]["NetworkProfileInput"];
export type NetworkProfile = AppComponents["schemas"]["NetworkProfile"];
export const emptyNetworkProfile = (): NetworkProfileInput => ({
  display_name: "",
  registered_name: "",
  city: "",
  uf: "",
  contact_name: "",
  contact_email: "",
  default_timezone: "",
  billing_customer_id: "",
});
function checkedProfile(
  p: NetworkProfileInput | undefined,
): NetworkProfileInput {
  if (
    !p ||
    Object.keys(emptyNetworkProfile()).some(
      (k) =>
        typeof p[k as keyof NetworkProfileInput] !== "string" ||
        p[k as keyof NetworkProfileInput].length > 500,
    )
  )
    throw new NetworkFailure(502);
  return p;
}
function checkedVersion(p: NetworkProfile | undefined): NetworkProfile {
  if (
    !p ||
    !Number.isInteger(p.version) ||
    p.version < 0 ||
    p.version > 2147483647
  )
    throw new NetworkFailure(502);
  checkedProfile(p.data);
  return p;
}
export type NetworkPage = { items: Network[]; next_cursor?: string };
export interface NetworkClient {
  list(after: string, signal?: AbortSignal): Promise<NetworkPage>;
  updateProfile(
    network: Network,
    profile: NetworkProfile,
    signal?: AbortSignal,
  ): Promise<NetworkProfile>;
  lookup(cnpj: string, signal?: AbortSignal): Promise<NetworkProfileInput>;
  create(input: NetworkInput, signal?: AbortSignal): Promise<Network>;
  retry(network: Network, signal?: AbortSignal): Promise<Network>;
}
export class NetworkFailure extends Error {
  constructor(
    readonly status: number,
    readonly kind = "",
  ) {
    super("Network request failed");
  }
}
export function networkMessage(error: unknown): string {
  if (error instanceof NetworkFailure) {
    if (error.status === 401) return "Sua sessão expirou. Entre novamente.";
    if (error.status === 403) return "Seu papel não permite esta operação.";
    if (error.status === 409)
      return "Rede já cadastrada ou tentativa alterada. Atualize a lista antes de tentar novamente.";
    if (error.status === 400)
      return "Revise os dados informados. Na criação, selecione um plano ativo.";
  }
  return "Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente.";
}
function checked(value: Network | undefined): Network {
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    !value ||
    !uuid.test(value.id) ||
    !uuid.test(value.plan_id) ||
    !/^[a-z0-9_]{3,40}$/.test(value.slug) ||
    typeof value.legal_name !== "string" ||
    !value.legal_name ||
    typeof value.cnpj !== "string" ||
    typeof value.plan_name !== "string" ||
    !value.plan_name ||
    !["trial", "active", "suspended", "cancelled"].includes(value.status) ||
    !["queued", "preparing", "ready", "failed"].includes(
      value.provision_status,
    ) ||
    !Number.isSafeInteger(value.schema_version) ||
    value.schema_version < 0 ||
    !Number.isInteger(value.generation) ||
    value.generation < 0 ||
    value.generation > 2147483647 ||
    (value.provision_status === "ready" && value.schema_version < 1)
  )
    throw new NetworkFailure(502);
  if (value.profile !== undefined) checkedVersion(value.profile);
  return value;
}
export function createNetworkClient(
  base: string,
  development = false,
): NetworkClient {
  createAuthClient(base, "platform", development);
  const api = createAppClient(new URL(base).origin);
  const options = (signal?: AbortSignal) => ({
    credentials: "include" as const,
    cache: "no-store" as const,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
  });
  async function guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof NetworkFailure) throw error;
      throw new NetworkFailure(0);
    }
  }
  return {
    lookup: (cnpj, signal) =>
      guarded(async () => {
        if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(cnpj)) throw new NetworkFailure(400);
        const r = await api.GET("/v1/hq/companies/{cnpj}", {
          ...options(signal),
          params: { path: { cnpj } },
        });
        if (!r.response.ok)
          throw new NetworkFailure(r.response.status, r.error?.type);
        return checkedProfile(r.data);
      }),
    updateProfile: (network, body, signal) =>
      guarded(async () => {
        const r = await api.PUT("/v1/hq/tenants/{id}/profile", {
          ...options(signal),
          params: {
            path: { id: network.id },
            header: { "X-CRMF-Request": "1" },
          },
          body,
        });
        if (r.response.status !== 200)
          throw new NetworkFailure(r.response.status, r.error?.type);
        return checkedVersion(r.data);
      }),
    list: (after, signal) =>
      guarded(async () => {
        const result = await api.GET("/v1/hq/tenants", {
          ...options(signal),
          params: { query: after ? { after } : {} },
        });
        if (!result.response.ok)
          throw new NetworkFailure(result.response.status, result.error?.type);
        if (
          !result.data ||
          !Array.isArray(result.data.items) ||
          result.data.items.length > 100 ||
          (result.data.next_cursor !== undefined &&
            !/^[a-z0-9_]{3,40}$/.test(result.data.next_cursor))
        )
          throw new NetworkFailure(502);
        result.data.items.forEach(checked);
        return result.data;
      }),
    create: (body, signal) =>
      guarded(async () => {
        const result = await api.POST("/v1/hq/tenants", {
          ...options(signal),
          params: { header: { "X-CRMF-Request": "1" } },
          body,
        });
        if (result.response.status !== 202)
          throw new NetworkFailure(result.response.status, result.error?.type);
        return checked(result.data);
      }),
    retry: (network, signal) =>
      guarded(async () => {
        const result = await api.POST("/v1/hq/tenants/{id}/retry", {
          ...options(signal),
          params: {
            path: { id: network.id },
            header: { "X-CRMF-Request": "1" },
          },
          body: { generation: network.generation },
        });
        if (result.response.status !== 202)
          throw new NetworkFailure(result.response.status, result.error?.type);
        return checked(result.data);
      }),
  };
}

import { createAppClient, type AppComponents } from "@crmf/api-client";
import { createAuthClient } from "@crmf/auth";
export type HQStore = AppComponents["schemas"]["HQStore"];
export type StoreInput = AppComponents["schemas"]["HQStoreInput"];
export type StoreUpdate = AppComponents["schemas"]["HQStoreUpdate"];
export type StorePage = { items: HQStore[]; next_cursor?: string };
export interface StoreClient {
  list(
    after: string,
    signal?: AbortSignal,
    tenantId?: string,
  ): Promise<StorePage>;
  get(id: string, signal?: AbortSignal): Promise<HQStore>;
  create(input: StoreInput, signal?: AbortSignal): Promise<HQStore>;
  update(
    id: string,
    input: StoreUpdate,
    signal?: AbortSignal,
  ): Promise<HQStore>;
}
export const isStoreID = (id: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) &&
  id !== "00000000-0000-0000-0000-000000000000";
export class StoreFailure extends Error {
  constructor(
    readonly status: number,
    readonly kind = "",
  ) {
    super("Store request failed");
  }
}
export function storeMessage(e: unknown) {
  if (e instanceof StoreFailure) {
    if (e.status === 401) return "Sua sessão expirou. Entre novamente.";
    if (e.status === 403) return "Seu papel não permite esta operação.";
    if (e.kind === "plan_limit")
      return "O limite de lojas do plano foi atingido. Consulte a assinatura da rede.";
    if (e.kind === "store_network_unavailable")
      return "A rede precisa estar ativa/em avaliação, preparada e com assinatura disponível.";
    if (e.kind === "store_identity_in_use")
      return "O código do ERP não pode mudar após o pareamento de um dispositivo.";
    if (e.status === 409)
      return "Código já usado nesta rede ou cadastro alterado. Atualize antes de tentar novamente.";
    if (e.status === 400) return "Revise os dados da loja.";
    if (e.status === 404) return "Loja não encontrada.";
  }
  return "Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente.";
}
function checked(v: HQStore | undefined): HQStore {
  if (
    !v ||
    !isStoreID(v.id) ||
    !isStoreID(v.tenant_id) ||
    typeof v.code !== "string" ||
    !v.code ||
    typeof v.name !== "string" ||
    !v.name ||
    typeof v.city !== "string" ||
    typeof v.uf !== "string" ||
    typeof v.timezone !== "string" ||
    !v.timezone ||
    v.erp !== "linx_big" ||
    !["active", "inactive"].includes(v.status) ||
    typeof v.network_name !== "string" ||
    !v.network_name ||
    typeof v.network_slug !== "string" ||
    !/^[a-z0-9_]{3,40}$/.test(v.network_slug) ||
    !Number.isInteger(v.version) ||
    v.version < 1 ||
    v.version > 2147483647
  )
    throw new StoreFailure(502);
  return v;
}
export function createStoreClient(
  base: string,
  development = false,
): StoreClient {
  createAuthClient(base, "platform", development);
  const api = createAppClient(new URL(base).origin);
  const options = (signal?: AbortSignal) => ({
    credentials: "include" as const,
    cache: "no-store" as const,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
  });
  async function guard<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof StoreFailure) throw e;
      throw new StoreFailure(0);
    }
  }
  return {
    list: (after, signal, tenantId) =>
      guard(async () => {
        if (
          (after && !isStoreID(after)) ||
          (tenantId !== undefined && !isStoreID(tenantId))
        )
          throw new StoreFailure(400);
        const r = await api.GET("/v1/hq/stores", {
          ...options(signal),
          params: {
            query: {
              ...(after ? { after } : {}),
              ...(tenantId ? { tenant_id: tenantId } : {}),
            },
          },
        });
        if (!r.response.ok)
          throw new StoreFailure(r.response.status, r.error?.type);
        if (
          !r.data ||
          !Array.isArray(r.data.items) ||
          r.data.items.length > 100 ||
          (r.data.next_cursor !== undefined && !isStoreID(r.data.next_cursor))
        )
          throw new StoreFailure(502);
        r.data.items.forEach((item) => {
          checked(item);
          if (tenantId && item.tenant_id !== tenantId)
            throw new StoreFailure(502);
        });
        return r.data;
      }),
    get: (id, signal) =>
      guard(async () => {
        if (!isStoreID(id)) throw new StoreFailure(400);
        const r = await api.GET("/v1/hq/stores/{id}", {
          ...options(signal),
          params: { path: { id } },
        });
        if (!r.response.ok)
          throw new StoreFailure(r.response.status, r.error?.type);
        const result = checked(r.data);
        if (result.id !== id) throw new StoreFailure(502);
        return result;
      }),
    create: (body, signal) =>
      guard(async () => {
        if (!isStoreID(body.tenant_id)) throw new StoreFailure(400);
        const r = await api.POST("/v1/hq/stores", {
          ...options(signal),
          params: { header: { "X-CRMF-Request": "1" } },
          body,
        });
        if (r.response.status !== 201)
          throw new StoreFailure(r.response.status, r.error?.type);
        const result = checked(r.data);
        if (result.tenant_id !== body.tenant_id) throw new StoreFailure(502);
        return result;
      }),
    update: (id, body, signal) =>
      guard(async () => {
        if (
          !isStoreID(id) ||
          !Number.isInteger(body.version) ||
          body.version < 1
        )
          throw new StoreFailure(400);
        const r = await api.PUT("/v1/hq/stores/{id}", {
          ...options(signal),
          params: { path: { id }, header: { "X-CRMF-Request": "1" } },
          body,
        });
        if (r.response.status !== 200)
          throw new StoreFailure(r.response.status, r.error?.type);
        const result = checked(r.data);
        if (result.id !== id || result.version !== body.version + 1)
          throw new StoreFailure(502);
        return result;
      }),
  };
}

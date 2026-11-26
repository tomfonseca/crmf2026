import { createAppClient, type AppComponents } from "@crmf/api-client";
import { createAuthClient } from "@crmf/auth";
import { isStoreID, StoreFailure } from "./stores-client";
export type PairingMeta = AppComponents["schemas"]["PairingMetadata"];
export interface PairingClient {
  get(id: string, signal: AbortSignal): Promise<PairingMeta | undefined>;
  issue(
    id: string,
    version: number,
    previous: string,
    signal: AbortSignal,
  ): Promise<{ current: PairingMeta; code: string }>;
  revoke(id: string, key: string, signal: AbortSignal): Promise<void>;
}
const states = ["pending", "used", "revoked", "expired", "invalidated"];
function checked(p: PairingMeta | undefined, id: string): PairingMeta {
  if (
    !p ||
    Object.keys(p).some(
      (k) => !["id", "store_id", "status", "expires_at"].includes(k),
    ) ||
    !isStoreID(p.id) ||
    p.store_id !== id ||
    !states.includes(p.status) ||
    typeof p.expires_at !== "string" ||
    !Number.isFinite(Date.parse(p.expires_at))
  )
    throw new StoreFailure(502);
  return p;
}
export function pairingMessage(e: unknown) {
  if (e instanceof StoreFailure) {
    if (e.status === 401) return "Sua sessão expirou. Entre novamente.";
    if (e.status === 403)
      return "Seu papel não permite emitir ou revogar códigos.";
    if (e.status === 429)
      return "Aguarde um minuto antes de emitir outro código.";
    if (e.status === 409)
      return "A loja ou o código mudou, ou a rede não está disponível. Atualize antes de continuar.";
  }
  return "Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.";
}
export function createPairingClient(
  base: string,
  development = false,
): PairingClient {
  createAuthClient(base, "platform", development);
  const api = createAppClient(new URL(base).origin);
  const opts = (signal: AbortSignal) => ({
    credentials: "include" as const,
    cache: "no-store" as const,
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
  });
  const path = (id: string) => {
    if (!isStoreID(id)) throw new StoreFailure(400);
    return { id };
  };
  async function guard<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof StoreFailure) throw e;
      throw new StoreFailure(0);
    }
  }
  return {
    get: (id, signal) =>
      guard(async () => {
        const r = await api.GET("/v1/hq/stores/{id}/pairing", {
          ...opts(signal),
          params: { path: path(id) },
        });
        if (!r.response.ok)
          throw new StoreFailure(r.response.status, r.error?.type);
        if (
          !r.data ||
          typeof r.data !== "object" ||
          Object.keys(r.data).some((k) => k !== "current")
        )
          throw new StoreFailure(502);
        return r.data.current === undefined
          ? undefined
          : checked(r.data.current, id);
      }),
    issue: (id, version, previous, signal) =>
      guard(async () => {
        if (
          !Number.isInteger(version) ||
          version < 1 ||
          version > 2147483647 ||
          (previous && !isStoreID(previous))
        )
          throw new StoreFailure(400);
        const r = await api.POST("/v1/hq/stores/{id}/pairing", {
          ...opts(signal),
          params: { path: path(id), header: { "X-CRMF-Request": "1" } },
          body: { store_version: version, previous_id: previous },
        });
        if (r.response.status !== 201)
          throw new StoreFailure(r.response.status, r.error?.type);
        const p = checked(r.data?.current, id);
        if (
          !r.data ||
          !/^[A-HJ-NP-Z2-9]{8}$/.test(r.data.code) ||
          p.status !== "pending" ||
          p.id === previous
        )
          throw new StoreFailure(502);
        return { current: p, code: r.data.code };
      }),
    revoke: (id, key, signal) =>
      guard(async () => {
        if (!isStoreID(key)) throw new StoreFailure(400);
        const r = await api.DELETE("/v1/hq/stores/{id}/pairing/{pairing_id}", {
          ...opts(signal),
          params: {
            path: { ...path(id), pairing_id: key },
            header: { "X-CRMF-Request": "1" },
          },
        });
        if (r.response.status !== 204)
          throw new StoreFailure(r.response.status, r.error?.type);
      }),
  };
}

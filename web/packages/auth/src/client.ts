import { createAppClient, type AppComponents } from "@crmf/api-client";
import { PasskeyFailure, validatePasskeyOptions } from "./passkey";

export type Realm = "platform" | "tenant";
type IdentityBody = AppComponents["schemas"]["Identity"];
export type Identity = Readonly<
  Omit<IdentityBody, "store_ids" | "grants"> & {
    store_ids: readonly string[];
    grants: readonly Readonly<AppComponents["schemas"]["IdentityGrant"]>[];
  }
>;
export type Outcome = AppComponents["schemas"]["AuthOutcome"];

export interface AuthClient {
  identity(signal?: AbortSignal): Promise<Identity | null>;
  login(
    email: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<Outcome>;
  passkey(response: string, signal?: AbortSignal): Promise<Outcome>;
  logout(signal?: AbortSignal): Promise<void>;
}

export class AuthFailure extends Error {
  constructor(readonly status: number) {
    super("Authentication request failed");
  }
}

export function authMessage(error: unknown): string {
  if (error instanceof PasskeyFailure) return error.message;
  if (!(error instanceof AuthFailure))
    return "Não foi possível conectar à autenticação. Tente novamente.";
  switch (error.status) {
    case 401:
      return "Credenciais ou código inválidos, ou desafio expirado. Tente novamente.";
    case 402:
      return "O acesso da rede está indisponível. Contate o administrador.";
    case 403:
      return "Acesso não permitido.";
    case 429:
      return "Muitas tentativas. Aguarde antes de tentar novamente.";
    default:
      return "Autenticação indisponível. Tente novamente mais tarde.";
  }
}

export function createAuthClient(
  baseUrl: string,
  realm: Realm,
  development = false,
): AuthClient {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid authentication endpoint");
  }
  if (realm !== "tenant" && realm !== "platform")
    throw new Error("Invalid authentication realm");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(development && local && url.protocol === "http:"))
  ) {
    throw new Error("Invalid authentication endpoint");
  }
  const api = createAppClient(url.origin);
  const routes =
    realm === "platform"
      ? ({
          me: "/v1/hq/me",
          login: "/v1/hq/auth/login",
          passkey: "/v1/hq/auth/passkey",
          logout: "/v1/hq/auth/logout",
        } as const)
      : ({
          me: "/v1/me",
          login: "/v1/auth/login",
          passkey: "/v1/auth/passkey",
          logout: "/v1/auth/logout",
        } as const);
  function options(signal?: AbortSignal) {
    const deadline = AbortSignal.timeout(12_000);
    return {
      credentials: "include" as const,
      cache: "no-store" as const,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    };
  }
  function mutationOptions(signal?: AbortSignal) {
    return {
      ...options(signal),
      params: { header: { "X-CRMF-Request": "1" as const } },
    };
  }
  async function guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AuthFailure) throw error;
      throw new AuthFailure(0);
    }
  }
  function outcome(data: Outcome | undefined): Outcome {
    if (
      !data ||
      !["authenticated", "passkey_required", "enrollment_required"].includes(
        data.status,
      )
    )
      throw new AuthFailure(502);
    if (data.status !== "authenticated") validatePasskeyOptions(data);
    if (
      data.recovery_codes &&
      (data.status !== "authenticated" ||
        data.recovery_codes.length !== 10 ||
        data.recovery_codes.some((code) => !/^[a-f0-9]{32}$/.test(code)))
    )
      throw new AuthFailure(502);
    return data;
  }
  return {
    identity: (signal) =>
      guarded(async () => {
        const result = await api.GET(routes.me, options(signal));
        if (result.response.status === 401) return null;
        if (!result.response.ok) throw new AuthFailure(result.response.status);
        const data = result.data;
        const roles =
          realm === "platform"
            ? ["platform_admin", "platform_support"]
            : ["network_admin", "store_manager", "employee"];
        if (
          !data ||
          data.realm !== realm ||
          typeof data.user_id !== "string" ||
          !data.user_id ||
          !Array.isArray(data.store_ids) ||
          !Array.isArray(data.grants) ||
          !data.grants.length ||
          data.grants.some((grant) => !roles.includes(grant.role)) ||
          (realm === "tenant" && !data.tenant_id) ||
          (realm === "platform" && data.tenant_id)
        ) {
          throw new AuthFailure(502);
        }
        const isUUID = (value: unknown): value is string =>
          typeof value === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            value,
          );
        if (
          !isUUID(data.user_id) ||
          data.store_ids.some((id) => !isUUID(id)) ||
          (realm === "tenant" && !isUUID(data.tenant_id)) ||
          data.grants.some(
            (grant) =>
              (grant.store_id !== undefined && !isUUID(grant.store_id)) ||
              (grant.seller_code !== undefined &&
                typeof grant.seller_code !== "string"),
          )
        )
          throw new AuthFailure(502);
        data.grants.forEach(Object.freeze);
        Object.freeze(data.grants);
        Object.freeze(data.store_ids);
        return Object.freeze(data);
      }),
    login: (email, password, signal) =>
      guarded(async () => {
        const result = await api.POST(routes.login, {
          ...mutationOptions(signal),
          body: { email, password },
        });
        if (!result.response.ok) throw new AuthFailure(result.response.status);
        return outcome(result.data);
      }),
    passkey: (response, signal) =>
      guarded(async () => {
        const result = await api.POST(routes.passkey, {
          ...mutationOptions(signal),
          body: { response },
        });
        if (!result.response.ok) throw new AuthFailure(result.response.status);
        return outcome(result.data);
      }),
    logout: (signal) =>
      guarded(async () => {
        const result = await api.POST(routes.logout, mutationOptions(signal));
        if (result.response.status !== 204)
          throw new AuthFailure(result.response.status);
      }),
  };
}

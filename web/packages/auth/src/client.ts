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

export type OwnSession = AppComponents["schemas"]["OwnSession"];
export type SessionPage = AppComponents["schemas"]["SessionPage"];
export interface AccountClient {
  sessions(after?: string, signal?: AbortSignal): Promise<SessionPage>;
  endSession(id: string, signal?: AbortSignal): Promise<void>;
  changePassword(
    current: string,
    next: string,
    signal?: AbortSignal,
  ): Promise<void>;
}
export interface AuthClient {
  readonly account?: AccountClient;
  readonly realm?: Realm;
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
  constructor(
    readonly status: number,
    readonly kind = "",
  ) {
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
          sessions: "/v1/hq/me/sessions",
          password: "/v1/hq/me/password",
          me: "/v1/hq/me",
          login: "/v1/hq/auth/login",
          passkey: "/v1/hq/auth/passkey",
          logout: "/v1/hq/auth/logout",
        } as const)
      : ({
          sessions: "/v1/me/sessions",
          password: "/v1/me/password",
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
  async function accountMutation(
    call: () => Promise<{ response: Response; error?: { type: string } }>,
  ) {
    const result = await call();
    if (result.response.status !== 204)
      throw new AuthFailure(result.response.status, result.error?.type);
  }
  const uuidPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  return {
    realm,
    account: {
      sessions: (after, signal) =>
        guarded(async () => {
          if (after && !uuidPattern.test(after)) throw new AuthFailure(400);
          const result = await api.GET(routes.sessions, {
            ...options(signal),
            params: { query: after ? { after } : {} },
          });
          if (result.response.status !== 200)
            throw new AuthFailure(result.response.status);
          const page = result.data;
          const keys = [
            "id",
            "created_at",
            "last_seen_at",
            "idle_expires_at",
            "expires_at",
            "current",
            "mfa_verified",
          ];
          if (
            !page ||
            Object.keys(page).some(
              (k) => !["items", "next_cursor"].includes(k),
            ) ||
            !Array.isArray(page.items) ||
            page.items.length > 100 ||
            (page.next_cursor !== undefined &&
              (!uuidPattern.test(page.next_cursor) ||
                page.items.length !== 100 ||
                page.items[99].id !== page.next_cursor)) ||
            new Set(page.items.map((s) => s.id)).size !== page.items.length ||
            page.items.filter((s) => s.current).length > 1 ||
            page.items.some(
              (s, i) =>
                Object.keys(s).length !== keys.length ||
                keys.some((k) => !(k in s)) ||
                !uuidPattern.test(s.id) ||
                (i > 0 && page.items[i - 1].id <= s.id) ||
                (after && s.id >= after) ||
                typeof s.current !== "boolean" ||
                typeof s.mfa_verified !== "boolean" ||
                [
                  s.created_at,
                  s.last_seen_at,
                  s.idle_expires_at,
                  s.expires_at,
                ].some(
                  (d) =>
                    typeof d !== "string" || !Number.isFinite(Date.parse(d)),
                ) ||
                Date.parse(s.created_at) > Date.parse(s.last_seen_at) ||
                Date.parse(s.last_seen_at) > Date.parse(s.idle_expires_at) ||
                Date.parse(s.idle_expires_at) > Date.parse(s.expires_at),
            )
          )
            throw new AuthFailure(502);
          return page;
        }),
      endSession: (id, signal) =>
        guarded(async () => {
          if (!uuidPattern.test(id)) throw new AuthFailure(400);
          await accountMutation(() =>
            api.DELETE(routes.sessions, {
              ...mutationOptions(signal),
              body: { session_id: id },
            }),
          );
        }),
      changePassword: (current, next, signal) =>
        guarded(async () => {
          if (
            !current ||
            new TextEncoder().encode(current).length > 1024 ||
            new TextEncoder().encode(next).length > 1024 ||
            Array.from(next).length < 12 ||
            next === current
          )
            throw new AuthFailure(400, "password_policy");
          await accountMutation(() =>
            api.POST(routes.password, {
              ...mutationOptions(signal),
              body: { current_password: current, new_password: next },
            }),
          );
        }),
    },
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

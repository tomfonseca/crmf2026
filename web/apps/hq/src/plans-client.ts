import { createAppClient, type AppComponents } from "@crmf/api-client";
import { createAuthClient } from "@crmf/auth";

export type Plan = AppComponents["schemas"]["Plan"];
export type PlanInput = AppComponents["schemas"]["PlanInput"];
export type PlanUpdate = AppComponents["schemas"]["PlanUpdate"];
export type PlanPage = { items: Plan[]; next_cursor?: string };
export interface PlanClient {
  list(after: string, signal?: AbortSignal): Promise<PlanPage>;
  create(input: PlanInput, signal?: AbortSignal): Promise<Plan>;
  update(id: string, input: PlanUpdate, signal?: AbortSignal): Promise<Plan>;
  remove(plan: Plan, confirmation: string, signal?: AbortSignal): Promise<void>;
}
export class PlanFailure extends Error {
  constructor(
    readonly status: number,
    readonly kind = "",
  ) {
    super("Plan catalog request failed");
  }
}
export function planMessage(error: unknown): string {
  if (error instanceof PlanFailure) {
    if (error.status === 401) return "Sua sessão expirou. Entre novamente.";
    if (error.status === 403) return "Seu papel não permite esta operação.";
    if (error.kind === "plan_in_use")
      return "Este plano possui assinatura e não pode ser excluído. Desative-o.";
    if (error.status === 409)
      return "O código já existe ou o plano foi alterado. Atualize a lista antes de tentar novamente.";
    if (error.status === 400)
      return "Revise os campos e a confirmação do plano.";
    if (error.status === 404) return "Plano não encontrado. Atualize a lista.";
  }
  return "Não foi possível confirmar a operação. Atualize a lista antes de tentar novamente.";
}
function checked(plan: Plan | undefined): Plan {
  const integer = (v: unknown, min: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= 2147483647;
  if (
    !plan ||
    typeof plan.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      plan.id,
    ) ||
    typeof plan.code !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(plan.code) ||
    typeof plan.name !== "string" ||
    !plan.name ||
    typeof plan.active !== "boolean" ||
    !integer(plan.price_cents, 0) ||
    !integer(plan.version, 1) ||
    !integer(plan.history_months, 1) ||
    !integer(plan.sync_interval_seconds, 1) ||
    !(plan.max_stores === null || integer(plan.max_stores, 1)) ||
    !(plan.max_users === null || integer(plan.max_users, 1)) ||
    !Array.isArray(plan.modules) ||
    plan.modules.some(
      (m) => !["core", "realtime", "export", "pulse"].includes(m),
    )
  )
    throw new PlanFailure(502);
  return plan;
}
export function createPlanClient(
  base: string,
  development = false,
): PlanClient {
  // Reuse the auth package's canonical URL validation; no network or fallback.
  createAuthClient(base, "platform", development);
  const api = createAppClient(new URL(base).origin);
  const options = (signal?: AbortSignal) => ({
    credentials: "include" as const,
    cache: "no-store" as const,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
      : AbortSignal.timeout(12000),
  });
  const mutation = (signal?: AbortSignal) => ({
    ...options(signal),
    params: { header: { "X-CRMF-Request": "1" as const } },
  });
  function reject(
    status: number,
    problem: AppComponents["schemas"]["Problem"] | undefined,
  ): never {
    throw new PlanFailure(status, problem?.type);
  }
  async function guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof PlanFailure) throw error;
      throw new PlanFailure(0);
    }
  }
  return {
    list: (after, signal) =>
      guarded(async () => {
        const result = await api.GET("/v1/hq/plans", {
          ...options(signal),
          params: { query: after ? { after } : {} },
        });
        if (!result.response.ok) reject(result.response.status, result.error);
        if (
          !result.data ||
          !Array.isArray(result.data.items) ||
          result.data.items.length > 100 ||
          (result.data.next_cursor !== undefined &&
            !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(result.data.next_cursor))
        )
          throw new PlanFailure(502);
        result.data.items.forEach(checked);
        return result.data;
      }),
    create: (body, signal) =>
      guarded(async () => {
        const result = await api.POST("/v1/hq/plans", {
          ...mutation(signal),
          body,
        });
        if (!result.response.ok) reject(result.response.status, result.error);
        return checked(result.data);
      }),
    update: (id, body, signal) =>
      guarded(async () => {
        const result = await api.PUT("/v1/hq/plans/{id}", {
          ...mutation(signal),
          params: { ...mutation().params, path: { id } },
          body,
        });
        if (!result.response.ok) reject(result.response.status, result.error);
        return checked(result.data);
      }),
    remove: (plan, confirmation, signal) =>
      guarded(async () => {
        const result = await api.DELETE("/v1/hq/plans/{id}", {
          ...mutation(signal),
          params: { ...mutation().params, path: { id: plan.id } },
          body: { version: plan.version, confirmation },
        });
        if (result.response.status !== 204)
          reject(result.response.status, result.error);
      }),
  };
}

import { afterEach, expect, test, vi } from "vitest";
import {
  createPlanClient,
  planMessage,
  PlanFailure,
  PLAN_CODE_PATTERN,
  isPlanCode,
} from "./plans-client";
import { parsePrice } from "./Plans";
afterEach(() => vi.unstubAllGlobals());
test.each([
  ["0", 0],
  ["29,90", 2990],
  ["1,5", 150],
  ["21474836,47", 2147483647],
] as const)("parses exact BRL %s", (input, expected) => {
  expect(parsePrice(input)).toBe(expected);
});
test.each(["-1", "1.25", "1e3", "1,234", "21474836,48", "NaN"])(
  "rejects invalid price %s",
  (input) => {
    expect(() => parsePrice(input)).toThrow();
  },
);
test("plan codes match the API contract and compile in native HTML Unicode-sets mode", () => {
  const native = new RegExp("^(?:" + PLAN_CODE_PATTERN + ")$", "v");
  for (const code of ["p01", "0", "p-01", "p_01", "p".repeat(64)]) {
    expect(isPlanCode(code)).toBe(true);
    expect(native.test(code)).toBe(true);
  }
  for (const code of [
    "P01",
    "",
    "_p01",
    "-p01",
    "p 01",
    "p.01",
    "p/01",
    "p\\n",
    "p".repeat(65),
    null,
    1,
  ])
    expect(isPlanCode(code)).toBe(false);
});
test("invalid create codes fail before fetch without silently lowercasing", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const body = {
    name: "Essencial",
    price_cents: 9990,
    active: true,
    sync_interval_seconds: 10800,
    history_months: 6,
    max_stores: 3,
    max_users: 15,
    modules: ["core", "export"] as ("core" | "export")[],
    code: "P01",
  };
  await expect(
    createPlanClient("https://api.example.invalid").create(body),
  ).rejects.toMatchObject({ status: 400, kind: "invalid_plan_code" });
  expect(fetch).not.toHaveBeenCalled();
  expect(body.code).toBe("P01");
  expect(planMessage(new PlanFailure(400, "invalid_plan_code"))).toContain(
    "p01",
  );
});
test("accepts the reported Essencial payload with the explicit lowercase code p01", async () => {
  const body = {
    name: "Essencial",
    price_cents: 9990,
    active: true,
    sync_interval_seconds: 10800,
    history_months: 6,
    max_stores: 3,
    max_users: 15,
    modules: ["core", "export"] as ("core" | "export")[],
    code: "p01",
  };
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ...body,
        id: "00000000-0000-7000-8000-000000000001",
        version: 1,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const created = await createPlanClient("https://api.example.invalid").create(
    body,
  );
  expect(created.code).toBe("p01");
  expect(fetch).toHaveBeenCalledOnce();
  expect(await (fetch.mock.calls[0][0] as Request).json()).toEqual(body);
});
test("omits the code and trusts the generated server identity on create", async () => {
  const body = {
    name: "Essencial",
    price_cents: 9990,
    active: true,
    sync_interval_seconds: 10800,
    history_months: 6,
    max_stores: 3,
    max_users: 15,
    modules: ["core", "export"] as ("core" | "export")[],
  };
  const code = "p_00000000000070008000000000000001";
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ...body,
        id: "00000000-0000-7000-8000-000000000001",
        code,
        version: 1,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const created = await createPlanClient("https://api.example.invalid").create(
    body,
  );
  expect(created.code).toBe(code);
  expect(await (fetch.mock.calls[0][0] as Request).json()).toEqual(body);
});
test("only sends versioned credentialed mutations to QG routes", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const client = createPlanClient("https://api.example.invalid");
  await client.remove(
    {
      id: "00000000-0000-7000-8000-000000000001",
      code: "test",
      version: 2,
      name: "Synthetic",
      price_cents: 0,
      active: true,
      sync_interval_seconds: 180,
      history_months: 12,
      max_stores: null,
      max_users: null,
      modules: [],
    },
    "test",
  );
  const request = fetch.mock.calls[0][0] as Request;
  expect(request.method).toBe("DELETE");
  expect(request.url).toContain("/v1/hq/plans/");
  expect(request.credentials).toBe("include");
  expect(request.cache).toBe("no-store");
  expect(request.headers.get("X-CRMF-Request")).toBe("1");
  expect(await request.json()).toEqual({ version: 2, confirmation: "test" });
});
test("redacts network/backend details and never returns a mocked catalog", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "catalog_unavailable",
          title: "private-secret-do-not-show",
          status: 503,
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    ),
  );
  const client = createPlanClient("https://api.example.invalid");
  try {
    await client.list("");
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(PlanFailure);
    expect(planMessage(error)).not.toContain("private-secret");
  }
  expect(() => createPlanClient("http://evil.example.invalid")).toThrow();
});

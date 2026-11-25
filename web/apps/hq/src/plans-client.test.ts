import { afterEach, expect, test, vi } from "vitest";
import { createPlanClient, planMessage, PlanFailure } from "./plans-client";
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

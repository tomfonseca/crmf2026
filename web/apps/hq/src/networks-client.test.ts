import { afterEach, expect, test, vi } from "vitest";
import {
  createNetworkClient,
  NetworkFailure,
  networkMessage,
  type Network,
} from "./networks-client";
afterEach(() => vi.unstubAllGlobals());
const network: Network = {
  id: "00000000-0000-7000-8000-000000000001",
  plan_id: "00000000-0000-7000-8000-000000000002",
  plan_name: "Synthetic",
  slug: "synthetic",
  legal_name: "Synthetic network",
  cnpj: "ABCDEFGHIJKL00",
  generation: 1,
  provision_status: "failed",
  schema_version: 0,
  status: "trial",
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
test("retries only a versioned authenticated network with no actor or credentials", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      respond({ ...network, generation: 2, provision_status: "queued" }, 202),
    );
  vi.stubGlobal("fetch", fetch);
  const client = createNetworkClient("https://api.example.invalid");
  await client.retry(network);
  const request = fetch.mock.calls[0][0] as Request;
  expect(request.credentials).toBe("include");
  expect(request.cache).toBe("no-store");
  expect(request.headers.get("X-CRMF-Request")).toBe("1");
  expect(new URL(request.url).pathname).toBe(
    "/v1/hq/tenants/" + network.id + "/retry",
  );
  expect(await request.json()).toEqual({ generation: 1 });
});
test.each([
  { ...network, provision_status: "ready", schema_version: 0 },
  { ...network, generation: -1 },
  { ...network, provision_status: "unknown" },
  { ...network, id: "untrusted" },
])("rejects malformed or false-ready networks", async (value) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(respond({ items: [value] })),
  );
  await expect(
    createNetworkClient("https://api.example.invalid").list(""),
  ).rejects.toMatchObject({ status: 502 });
});
test("never displays private backend errors or silently substitutes data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(respond({ type: "private-error-secret" }, 503)),
  );
  try {
    await createNetworkClient("https://api.example.invalid").list("");
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(NetworkFailure);
    expect(networkMessage(error)).not.toContain("private-error");
  }
  expect(() =>
    createNetworkClient("http://untrusted.example.invalid"),
  ).toThrow();
});

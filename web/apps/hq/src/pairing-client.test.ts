import { afterEach, expect, test, vi } from "vitest";
import { createPairingClient } from "./pairing-client";
const id = "00000000-0000-7000-8000-000000000001",
  key = "00000000-0000-7000-8000-000000000002";
const meta = {
  id: key,
  store_id: id,
  status: "pending",
  expires_at: "2026-12-01T12:00:00Z",
};
const response = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => vi.unstubAllGlobals());
test("pairing GET cannot recover secrets, malformed metadata fails closed", async () => {
  for (const b of [
    { code: "ABCD2345" },
    { current: { ...meta, code_hash: "secret" } },
    { current: { ...meta, store_id: key } },
    { current: { ...meta, expires_at: "invalid" } },
    { current: null },
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(b)));
    await expect(
      createPairingClient("https://api.example.invalid").get(
        id,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 502 });
  }
});
test("issue has exact revision/CAS payload, cookie-only no-store and canonical secret", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(response({ current: meta, code: "ABCD2345" }, 201));
  vi.stubGlobal("fetch", fetch);
  const c = createPairingClient("https://api.example.invalid");
  expect((await c.issue(id, 1, "", new AbortController().signal)).code).toBe(
    "ABCD2345",
  );
  const r = fetch.mock.calls[0][0] as Request;
  expect(r.credentials).toBe("include");
  expect(r.cache).toBe("no-store");
  expect(r.headers.get("X-CRMF-Request")).toBe("1");
  expect(await r.json()).toEqual({ store_version: 1, previous_id: "" });
  expect(r.headers.has("Authorization")).toBe(false);
  await expect(
    c.issue(id, 0, "", new AbortController().signal),
  ).rejects.toMatchObject({ status: 400 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test("unknown status, failed mutation and 200 instead of 201 never become success", async () => {
  for (const [b, s] of [
    [{ current: { ...meta, status: "ready" }, code: "ABCD2345" }, 201],
    [{ current: meta, code: "ABCD2345" }, 200],
    [{ type: "pairing_conflict" }, 409],
  ] as const) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(b, s)));
    await expect(
      createPairingClient("https://api.example.invalid").issue(
        id,
        1,
        "",
        new AbortController().signal,
      ),
    ).rejects.toBeDefined();
  }
});
test("absence is confirmed only by a successful checked object; revoke is exact and body-free", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const c = createPairingClient("https://api.example.invalid");
  expect(await c.get(id, new AbortController().signal)).toBeUndefined();
  await c.revoke(id, key, new AbortController().signal);
  const r = fetch.mock.calls[1][0] as Request;
  expect(r.method).toBe("DELETE");
  expect(await r.text()).toBe("");
  expect(new URL(r.url).pathname).toBe(
    "/v1/hq/stores/" + id + "/pairing/" + key,
  );
});

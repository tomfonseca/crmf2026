import { afterEach, expect, test, vi } from "vitest";
import {
  createStoreClient,
  StoreFailure,
  storeMessage,
  type HQStore,
} from "./stores-client";
afterEach(() => vi.unstubAllGlobals());
const id = "00000000-0000-7000-8000-000000000001";
const store: HQStore = {
  id,
  tenant_id: id,
  network_name: "Rede sintética",
  network_slug: "synthetic",
  code: "S001",
  name: "Loja sintética",
  city: "",
  uf: "",
  timezone: "America/Sao_Paulo",
  erp: "linx_big",
  status: "active",
  version: 1,
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("creates with opaque-session credentials and exact store fields, never actor or pairing data", async () => {
  const fetch = vi.fn().mockResolvedValue(respond(store, 201));
  vi.stubGlobal("fetch", fetch);
  const input = {
    tenant_id: id,
    code: store.code,
    name: store.name,
    city: "",
    uf: "",
    timezone: store.timezone,
    erp: store.erp,
    status: store.status,
  };
  await createStoreClient("https://api.example.invalid").create(input);
  const r = fetch.mock.calls[0][0] as Request;
  expect(r.credentials).toBe("include");
  expect(r.cache).toBe("no-store");
  expect(r.headers.get("X-CRMF-Request")).toBe("1");
  expect(r.method).toBe("POST");
  expect(await r.json()).toEqual(input);
});
test.each([
  { ...store, id: "unknown" },
  { ...store, tenant_id: "unknown" },
  { ...store, status: "offline" },
  { ...store, version: 0 },
  { ...store, erp: "unknown" },
])("malformed configuration never becomes a usable store", async (value) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(respond({ items: [value] })),
  );
  await expect(
    createStoreClient("https://api.example.invalid").list(""),
  ).rejects.toMatchObject({ status: 502 });
});
test("wrong identity, oversized pages, transport failure and backend private errors fail closed", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      respond({ ...store, id: "00000000-0000-7000-8000-000000000002" }),
    )
    .mockResolvedValueOnce(
      respond({ items: Array.from({ length: 101 }, () => store) }),
    )
    .mockRejectedValueOnce(new Error("private transport secret"))
    .mockResolvedValueOnce(respond({ type: "private-backend-secret" }, 503));
  vi.stubGlobal("fetch", fetch);
  const c = createStoreClient("https://api.example.invalid");
  await expect(c.get(id)).rejects.toMatchObject({ status: 502 });
  await expect(c.list("")).rejects.toMatchObject({ status: 502 });
  await expect(c.list("")).rejects.toMatchObject({ status: 0 });
  try {
    await c.list("");
    throw Error("expected failure");
  } catch (e) {
    expect(e).toBeInstanceOf(StoreFailure);
    expect(storeMessage(e)).not.toContain("private");
  }
});
test("tenant-filtered catalogs bind the response to the requested network", async () => {
  const other = "00000000-0000-7000-8000-000000000002";
  const fetch = vi
    .fn()
    .mockResolvedValue(respond({ items: [{ ...store, tenant_id: other }] }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    createStoreClient("https://api.example.invalid").list("", undefined, id),
  ).rejects.toMatchObject({ status: 502 });
  const r = fetch.mock.calls[0][0] as Request;
  expect(new URL(r.url).searchParams.get("tenant_id")).toBe(id);
});
test("invalid selectors are rejected before requests; insecure configuration is not a fallback", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const c = createStoreClient("https://api.example.invalid");
  await expect(c.list("../other")).rejects.toMatchObject({ status: 400 });
  await expect(c.get("unverified")).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
  expect(() => createStoreClient("http://untrusted.example.invalid")).toThrow();
});

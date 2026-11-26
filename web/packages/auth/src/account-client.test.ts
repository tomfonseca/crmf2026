import { afterEach, expect, test, vi } from "vitest";
import { AuthFailure, createAuthClient } from "./client";
afterEach(() => vi.unstubAllGlobals());
test.each(["tenant", "platform"] as const)(
  "account client %s uses own realm, cookies, no-store and CSRF",
  async (realm) => {
    const fetch = vi.fn().mockImplementation((r: Request) =>
      Promise.resolve(
        r.method === "GET"
          ? new Response(JSON.stringify({ items: [] }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response(null, { status: 204 }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createAuthClient(
      "https://api.example.invalid",
      realm,
    ).account!;
    await client.sessions();
    await client.endSession("00000000-0000-7000-8000-000000000001");
    await client.changePassword(
      "Old disposable password",
      "New disposable password",
    );
    for (const call of fetch.mock.calls) {
      const r = call[0];
      expect(r.url).toContain(realm === "platform" ? "/v1/hq/me/" : "/v1/me/");
      expect(r.credentials).toBe("include");
      expect(r.cache).toBe("no-store");
      expect(r.headers.has("Authorization")).toBe(false);
      if (r.method !== "GET") expect(r.headers.get("X-CRMF-Request")).toBe("1");
    }
  },
);
test("account client rejects secret-bearing/unordered metadata and unexpected mutation response", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ items: [], token: "private" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const account = createAuthClient(
    "https://api.example.invalid",
    "tenant",
  ).account!;
  await expect(account.sessions()).rejects.toMatchObject({ status: 502 });
  fetch.mockResolvedValue(
    new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await expect(
    account.endSession("00000000-0000-7000-8000-000000000001"),
  ).rejects.toBeInstanceOf(AuthFailure);
  await expect(account.changePassword("old", "short")).rejects.toMatchObject({
    kind: "password_policy",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

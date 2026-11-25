import { afterEach, describe, expect, test, vi } from "vitest";
import { AuthFailure, authMessage, createAuthClient } from "./client";
import { validatePasskeyOptions } from "./passkey";

afterEach(() => vi.unstubAllGlobals());
describe("secure auth transport", () => {
  test.each([
    "http://example.invalid",
    "https://user:secret@example.invalid",
    "https://example.invalid/api",
    "https://example.invalid?token=secret",
    "https://example.invalid#secret",
  ])("rejects unsafe endpoint %s", (url) => {
    expect(() => createAuthClient(url, "platform")).toThrow();
  });
  test("only permits local HTTP explicitly in development", () => {
    expect(() => createAuthClient("http://localhost:8080", "tenant")).toThrow();
    expect(() =>
      createAuthClient("http://localhost:8080", "tenant", true),
    ).not.toThrow();
    expect(() =>
      createAuthClient("http://evil.localhost.invalid", "tenant", true),
    ).toThrow();
  });
  test.each(["platform", "tenant"] as const)(
    "uses generated %s paths, credentialed cookies and CSRF header",
    async (realm) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "authenticated" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await createAuthClient("https://api.example.invalid", realm).login(
        "fixture@example.invalid",
        "synthetic-password-only",
      );
      const request = fetch.mock.calls[0][0] as Request;
      expect(request.url).toBe(
        `https://api.example.invalid/v1/${realm === "platform" ? "hq/" : ""}auth/login`,
      );
      expect(request.credentials).toBe("include");
      expect(request.cache).toBe("no-store");
      expect(request.headers.get("X-CRMF-Request")).toBe("1");
      expect(request.headers.has("Authorization")).toBe(false);
      expect(await request.json()).toEqual({
        email: "fixture@example.invalid",
        password: "synthetic-password-only",
      });
    },
  );
  test("does not echo backend body, URL or credentials in errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: "do-not-display-this-secret" }), {
          status: 403,
          headers: { "Content-Type": "application/problem+json" },
        }),
      ),
    );
    const client = createAuthClient("https://api.example.invalid", "platform");
    await expect(
      client.login("fixture@example.invalid", "synthetic"),
    ).rejects.toThrow("Authentication request failed");
    expect(authMessage(new AuthFailure(403))).not.toContain("do-not-display");
  });
  test("rejects wrong-realm identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            realm: "tenant",
            user_id: "synthetic-user",
            tenant_id: "synthetic-tenant",
            store_ids: [],
            grants: [{ role: "network_admin" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    await expect(
      createAuthClient("https://api.example.invalid", "platform").identity(),
    ).rejects.toThrow();
  });
  test("401 means no session; outages are not anonymous/demo success", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const client = createAuthClient("https://api.example.invalid", "tenant");
    expect(await client.identity()).toBeNull();
    await expect(client.identity()).rejects.toThrow();
  });
  test("logout only succeeds on 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(
      createAuthClient("https://api.example.invalid", "tenant").logout(),
    ).rejects.toThrow();
  });
  test("rejects missing or weakened passkey options instead of a TOTP fallback", () => {
    expect(() =>
      validatePasskeyOptions({ status: "enrollment_required" }),
    ).toThrow();
    expect(() =>
      validatePasskeyOptions({ status: "passkey_required", public_key: "{}" }),
    ).toThrow();
    expect(() =>
      validatePasskeyOptions({
        status: "passkey_required",
        public_key: JSON.stringify({
          challenge: "a".repeat(43),
          rpId: "localhost",
          userVerification: "preferred",
          allowCredentials: [{ id: "synthetic" }],
        }),
      }),
    ).toThrow();
  });
  test.each(["tenant", "platform"] as const)(
    "submits WebAuthn proof only to the %s realm",
    async (realm) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "authenticated" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const response = '{"type":"public-key","synthetic":true}';
      await createAuthClient("https://api.example.invalid", realm).passkey(
        response,
      );
      const request = fetch.mock.calls[0][0] as Request;
      expect(request.url).toBe(
        `https://api.example.invalid/v1/${realm === "platform" ? "hq/" : ""}auth/passkey`,
      );
      expect(await request.json()).toEqual({ response });
      expect(request.headers.get("X-CRMF-Request")).toBe("1");
      expect(request.credentials).toBe("include");
    },
  );
});

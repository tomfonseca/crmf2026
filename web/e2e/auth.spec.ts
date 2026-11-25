import { expect, test } from "@playwright/test";

// Browser/contract tests use synthetic responses only. Backend cookie/MFA
// transactions are covered separately by the real-Postgres HTTPS tests.
for (const realm of ["platform", "tenant"] as const) {
  test(`${realm} login/MFA stays separate from demo and never persists secrets`, async ({
    page,
  }) => {
    let authenticated = false;
    const prefix = realm === "platform" ? "/v1/hq" : "/v1";
    const app = realm === "platform" ? "http://127.0.0.1:5177/" : "/login";
    const identity = {
      user_id: "00000000-0000-7000-8000-000000000001",
      realm,
      store_ids: [],
      ...(realm === "tenant"
        ? { tenant_id: "00000000-0000-7000-8000-000000000002" }
        : {}),
      grants: [
        { role: realm === "platform" ? "platform_admin" : "network_admin" },
      ],
    };
    const actions: string[] = [];
    await page.route("http://localhost:8080/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const headers = {
        "Access-Control-Allow-Origin":
          realm === "platform"
            ? "http://127.0.0.1:5177"
            : "http://127.0.0.1:5175",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "content-type,x-crmf-request",
        "Access-Control-Allow-Methods": "GET,POST",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      };
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      expect(path.startsWith(prefix + "/")).toBe(true);
      if (request.method() === "POST")
        expect(request.headers()["x-crmf-request"]).toBe("1");
      if (path === prefix + "/me")
        return route.fulfill({
          status: authenticated ? 200 : 401,
          headers,
          body: authenticated ? JSON.stringify(identity) : "{}",
        });
      actions.push(path);
      if (path === prefix + "/auth/login")
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({ status: "mfa_required" }),
        });
      if (path === prefix + "/auth/mfa") {
        authenticated = true;
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({ status: "authenticated" }),
        });
      }
      if (path === prefix + "/auth/logout") {
        authenticated = false;
        return route.fulfill({ status: 204, headers });
      }
      return route.fulfill({ status: 404, headers, body: "{}" });
    });
    await page.goto(app);
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("fixture@example.invalid");
    await page
      .getByLabel("Senha", { exact: true })
      .fill("synthetic-password-only");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Verificação em duas etapas" }),
    ).toBeVisible();
    await expect(page.getByText("Sessão autenticada.")).toHaveCount(0);
    await page
      .getByLabel("Código do autenticador ou de recuperação")
      .fill("123456");
    await page.getByRole("button", { name: "Verificar código" }).click();
    await expect(page.getByText("Sessão autenticada.")).toBeVisible();
    expect(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    ).toEqual([0, 0]);
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
    expect(actions).toEqual([
      prefix + "/auth/login",
      prefix + "/auth/mfa",
      prefix + "/auth/logout",
    ]);
  });
}
test("mobile auth outage fails closed without demo fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.route("http://localhost:8080/v1/**", (route) =>
    route.abort("failed"),
  );
  await page.goto("/login");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText(
      "Não foi possível verificar sua sessão. Nenhum acesso de demonstração foi concedido.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

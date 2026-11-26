import { expect, test } from "@playwright/test";
const proof = "A".repeat(43);
const password = "Disposable browser reset passphrase! 2026";
for (const realm of ["platform", "tenant"] as const) {
  test(`${realm} reset link is memory-only, uses strict realm and preserves login/MFA boundary`, async ({
    page,
  }) => {
    const platform = realm === "platform";
    const root = platform ? "http://localhost:5177" : "http://localhost:5175";
    const prefix = platform ? "/v1/hq" : "/v1";
    const path = platform ? "/nova-senha" : "/login/nova-senha";
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let writes = 0;
    await page.route("http://localhost:8080/v1/**", async (route) => {
      const req = route.request();
      const headers = {
        "Access-Control-Allow-Origin": root,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "content-type,x-crmf-request",
        "Access-Control-Allow-Methods": "GET,POST",
        "Cache-Control": "no-store",
        "Content-Type": "application/problem+json",
      };
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      expect(new URL(req.url()).pathname.startsWith(prefix + "/")).toBe(true);
      expect(req.url()).not.toContain(proof);
      if (req.method() === "POST") {
        expect(new URL(req.url()).pathname).toBe(
          prefix + "/auth/password/reset",
        );
        expect(req.headers()["x-crmf-request"]).toBe("1");
        expect(req.postDataJSON()).toEqual({
          token: proof,
          new_password: password,
        });
        writes++;
        return route.fulfill({
          status: writes === 1 ? 400 : 204,
          headers,
          ...(writes === 1
            ? { body: JSON.stringify({ type: "password_policy", status: 400 }) }
            : {}),
        });
      }
      return route.fulfill({ status: 401, headers, body: "{}" });
    });
    await page.goto(root + path + "#token=" + proof);
    await expect(
      page.getByRole("heading", { name: "Criar nova senha", exact: true }),
    ).toBeVisible();
    expect(page.url()).toBe(root + path);
    for (let i = 0; i < 2; i++) {
      await page.getByLabel("Nova senha", { exact: true }).fill(password);
      await page
        .getByLabel("Confirmar nova senha", { exact: true })
        .fill(password);
      await page
        .getByRole("button", { name: "Redefinir senha", exact: true })
        .click();
      if (i === 0) {
        await expect(page.getByRole("alert")).toContainText("fora da lista");
        await expect(
          page.getByLabel("Nova senha", { exact: true }),
        ).toHaveValue("");
        await expect(
          page.getByLabel("Confirmar nova senha", { exact: true }),
        ).toHaveValue("");
      }
    }
    await expect(
      page.getByRole("heading", { name: "Senha redefinida", exact: true }),
    ).toBeVisible();
    expect(writes).toBe(2);
    await page.setViewportSize({ width: 320, height: 800 });
    await page
      .getByRole("button", { name: "Usar tema escuro", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.evaluate(() => Object.values(localStorage))).toEqual([
      "dark",
    ]);
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
    await page
      .getByRole("button", { name: "Ir para o login", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Entrar", exact: true }),
    ).toBeVisible();
    await page.goto(root + path);
    await expect(
      page.getByRole("heading", { name: "Link indisponível", exact: true }),
    ).toBeVisible();
    expect(writes).toBe(2);
    expect(errors).toEqual([]);
  });
}

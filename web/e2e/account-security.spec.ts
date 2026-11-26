import { expect, test } from "@playwright/test";
for (const realm of ["platform", "tenant"] as const) {
  test(`${realm} own-account security: selective sessions, password and mobile themes`, async ({
    page,
  }) => {
    const platform = realm === "platform",
      root = platform ? "http://localhost:5177" : "http://localhost:5175",
      prefix = platform ? "/v1/hq" : "/v1",
      accountPath = platform ? "/minha-conta" : "/login/minha-conta";
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let signedIn = true,
      change = 0,
      ended = 0;
    const id = "00000000-0000-7000-8000-000000000009";
    let sessions = [
      {
        id,
        current: false,
        created_at: "2026-01-01T10:00:00Z",
        last_seen_at: "2026-01-01T11:00:00Z",
        idle_expires_at: "2026-01-01T12:00:00Z",
        expires_at: "2026-01-01T22:00:00Z",
        mfa_verified: true,
      },
      {
        id: "00000000-0000-7000-8000-000000000001",
        current: true,
        created_at: "2026-01-01T10:00:00Z",
        last_seen_at: "2026-01-01T11:00:00Z",
        idle_expires_at: "2026-01-01T12:00:00Z",
        expires_at: "2026-01-01T22:00:00Z",
        mfa_verified: true,
      },
    ];
    await page.route("http://localhost:8080/v1/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname,
        headers = {
          "Access-Control-Allow-Origin": root,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "content-type,x-crmf-request",
          "Access-Control-Allow-Methods": "GET,POST,DELETE",
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        };
      if (req.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      expect(path.startsWith(prefix + "/")).toBe(true);
      if (path === prefix + "/me")
        return route.fulfill({
          status: signedIn ? 200 : 401,
          headers,
          body: JSON.stringify(
            signedIn
              ? {
                  user_id: "00000000-0000-7000-8000-000000000007",
                  realm,
                  store_ids: [],
                  ...(platform
                    ? {}
                    : { tenant_id: "00000000-0000-7000-8000-000000000008" }),
                  grants: [
                    { role: platform ? "platform_support" : "network_admin" },
                  ],
                }
              : {},
          ),
        });
      if (req.method() !== "GET")
        expect(req.headers()["x-crmf-request"]).toBe("1");
      if (path === prefix + "/me/sessions") {
        if (req.method() === "DELETE") {
          expect(req.postDataJSON()).toEqual({ session_id: id });
          ended++;
          sessions = sessions.filter((s) => s.id !== id);
          return route.fulfill({ status: 204, headers });
        }
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({ items: sessions }),
        });
      }
      if (path === prefix + "/me/password") {
        expect(req.postDataJSON()).toEqual({
          current_password: "Original disposable passphrase",
          new_password: "Changed disposable passphrase",
        });
        change++;
        signedIn = false;
        return route.fulfill({ status: 204, headers });
      }
      throw new Error("Unexpected account API path " + path);
    });
    await page.goto(root + accountPath);
    await expect(
      page.getByRole("heading", { name: "Minha conta", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Sessões", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Encerrar esta sessão", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Encerrar sessão " + id, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(ended).toBe(0);
    await page
      .getByRole("button", { name: "Encerrar sessão " + id, exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Confirmar encerramento" })
      .click();
    await expect(
      page.getByText("Sessão encerrada. Atualize para conferir a lista atual."),
    ).toBeVisible();
    expect(ended).toBe(1);
    await page.setViewportSize({ width: 320, height: 800 });
    for (const dark of [false, true]) {
      if (dark)
        await page
          .getByRole("button", { name: "Usar tema escuro", exact: true })
          .click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("tab", { name: "Senha", exact: true }).click();
    await page
      .getByLabel("Senha atual", { exact: true })
      .fill("Original disposable passphrase");
    await page
      .getByLabel("Nova senha", { exact: true })
      .fill("Changed disposable passphrase");
    await page
      .getByLabel("Confirmar nova senha", { exact: true })
      .fill("Changed disposable passphrase");
    await page.getByRole("button", { name: "Salvar senha" }).click();
    await expect(
      page.getByRole("heading", {
        name: platform ? "Entrar no QG" : "Entrar",
        exact: true,
      }),
    ).toBeVisible();
    expect(change).toBe(1);
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      ),
    ).not.toMatch(/disposable|session_id|user_id/);
    expect(errors).toEqual([]);
  });
}

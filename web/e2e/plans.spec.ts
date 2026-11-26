import { expect, test } from "@playwright/test";
const origin = "http://localhost:5177";
const id = "00000000-0000-7000-8000-000000000001";
for (const support of [false, true]) {
  test(
    support
      ? "QG support is read-only at 360px"
      : "QG plan CRUD preserves cents, null quotas and revisions",
    async ({ page }) => {
      if (support) await page.setViewportSize({ width: 360, height: 780 });
      let plan: Record<string, unknown> | null = null;
      let expired = false;
      const mutations: string[] = [];
      await page.route("http://localhost:8080/v1/hq/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const headers = {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "content-type,x-crmf-request",
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE",
        };
        if (request.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        if (path === "/v1/hq/me")
          return route.fulfill({
            status: expired ? 401 : 200,
            headers,
            body: expired
              ? "{}"
              : JSON.stringify({
                  user_id: id,
                  realm: "platform",
                  store_ids: [],
                  grants: [
                    { role: support ? "platform_support" : "platform_admin" },
                  ],
                }),
          });
        if (path.startsWith("/v1/hq/plans")) {
          if (expired)
            return route.fulfill({
              status: 401,
              headers,
              body: JSON.stringify({
                type: "unauthenticated",
                title: "expired",
                status: 401,
              }),
            });
          if (request.method() === "GET")
            return route.fulfill({
              status: 200,
              headers,
              body: JSON.stringify({ items: plan ? [plan] : [] }),
            });
          expect(request.headers()["x-crmf-request"]).toBe("1");
          expect(support).toBe(false);
          mutations.push(request.method());
          const body = request.postDataJSON();
          if (request.method() === "POST") {
            expect(body.price_cents).toBe(2990);
            expect(body.max_stores).toBeNull();
            plan = { ...body, id, version: 1 };
            return route.fulfill({
              status: 201,
              headers,
              body: JSON.stringify(plan),
            });
          }
          if (request.method() === "PUT") {
            expect(body.version).toBe(1);
            plan = { ...plan, ...body, version: 2 };
            return route.fulfill({
              status: 200,
              headers,
              body: JSON.stringify(plan),
            });
          }
          expect(body).toEqual({ version: 2, confirmation: "synthetic" });
          plan = null;
          return route.fulfill({ status: 204, headers });
        }
        return route.fulfill({ status: 404, headers, body: "{}" });
      });
      if (support)
        plan = {
          id,
          code: "synthetic",
          name: "Plano sintético",
          price_cents: 2990,
          active: true,
          sync_interval_seconds: 180,
          history_months: 12,
          max_stores: null,
          max_users: 10,
          modules: ["core"],
          version: 1,
        };
      await page.goto(origin + "/");
      await expect(
        page.getByRole("heading", { name: "Planos", exact: true }),
      ).toBeVisible();
      if (support) {
        await expect(
          page.getByText("Acesso de suporte: somente leitura."),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Cadastrar plano" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: /Editar Plano/ }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Tema escuro", exact: true })
          .click();
        await expect(page.locator("main")).toHaveAttribute(
          "data-theme",
          "dark",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        return;
      }
      await expect(page.getByText("Nenhum plano nesta página.")).toBeVisible();
      await page.getByRole("button", { name: "Cadastrar plano" }).click();
      await page.getByLabel(/^Código/).fill("synthetic");
      await page.getByLabel("Nome", { exact: true }).fill("Plano sintético");
      await page.getByLabel("Preço (R$)", { exact: true }).fill("29,90");
      await page.getByLabel("Intervalo de sincronização (minutos)").fill("3");
      await page.getByLabel("Histórico (meses)").fill("12");
      await page.getByLabel("Ilimitado — usuários", { exact: true }).uncheck();
      await page
        .getByLabel("Máximo de usuários (vazio = ilimitado)")
        .fill("10");
      await page.getByLabel("core", { exact: true }).check();
      const code = page.getByLabel(/^Código/);
      await code.fill("P01");
      expect(
        await code.evaluate((input: HTMLInputElement) => input.checkValidity()),
      ).toBe(false);
      await page
        .getByRole("button", { name: "Salvar plano", exact: true })
        .click();
      await expect(code).toHaveAttribute("aria-invalid", "true");
      await expect(
        page.getByText(
          "Use letras minúsculas, números, _ ou -, começando por letra ou número. Ex.: p01.",
        ),
      ).toBeVisible();
      expect(mutations).toEqual([]);
      await code.fill("synthetic");
      await expect(code).not.toHaveAttribute("aria-invalid", "true");
      await page
        .getByRole("button", { name: "Salvar plano", exact: true })
        .click();
      await expect(page.getByRole("cell", { name: /29,90/ })).toBeVisible();
      await page
        .getByRole("button", { name: "Editar Plano sintético", exact: true })
        .click();
      await expect(page.getByLabel(/^Código/)).toHaveAttribute("readonly", "");
      await page.getByLabel("Plano ativo", { exact: true }).uncheck();
      await page
        .getByRole("button", { name: "Salvar plano", exact: true })
        .click();
      await expect(
        page.getByRole("cell", { name: "Desativado", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Excluir Plano sintético", exact: true })
        .click();
      await page
        .getByLabel("Digite o código synthetic para confirmar")
        .fill("synthetic");
      await page
        .getByRole("button", { name: "Excluir plano", exact: true })
        .click();
      await expect(page.getByText("Nenhum plano nesta página.")).toBeVisible();
      expect(mutations).toEqual(["POST", "PUT", "DELETE"]);
      expired = true;
      await page.getByRole("button", { name: "Atualizar lista" }).click();
      await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Planos", exact: true }),
      ).toHaveCount(0);
    },
  );
}

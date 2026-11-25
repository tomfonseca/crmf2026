import { expect, test } from "@playwright/test";
const origin = "http://localhost:5177";
const id = "00000000-0000-7000-8000-000000000001";
for (const support of [false, true]) {
  test(
    support
      ? "QG networks support readonly on mobile"
      : "QG creates networks and retries the same identity",
    async ({ page }) => {
      if (support) await page.setViewportSize({ width: 360, height: 780 });
      let state = "failed";
      let status = "trial";
      let created = support;
      let generation = 1;
      let writes = 0;
      await page.route("http://localhost:8080/v1/hq/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const headers = {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "content-type,x-crmf-request",
          "Access-Control-Allow-Methods": "GET,POST",
        };
        if (request.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        if (path === "/v1/hq/me")
          return route.fulfill({
            headers,
            body: JSON.stringify({
              user_id: id,
              realm: "platform",
              store_ids: [],
              grants: [
                { role: support ? "platform_support" : "platform_admin" },
              ],
            }),
          });
        if (path === "/v1/hq/plans")
          return route.fulfill({
            headers,
            body: JSON.stringify({
              items: [
                {
                  id,
                  code: "synthetic",
                  name: "Plano sintético",
                  active: true,
                  price_cents: 1000,
                  sync_interval_seconds: 180,
                  history_months: 12,
                  max_stores: null,
                  max_users: null,
                  modules: ["core"],
                  version: 1,
                },
              ],
            }),
          });
        const network = () => ({
          id,
          slug: "synthetic",
          legal_name: "Rede sintética",
          cnpj: "ABCDEFGHIJKL00",
          plan_id: id,
          plan_name: "Plano sintético",
          status,
          provision_status: state,
          schema_version: state === "ready" ? 1 : 0,
          generation,
        });
        if (path === "/v1/hq/tenants" && request.method() === "GET")
          return route.fulfill({
            headers,
            body: JSON.stringify({ items: created ? [network()] : [] }),
          });
        expect(support).toBe(false);
        expect(request.headers()["x-crmf-request"]).toBe("1");
        writes++;
        if (path.endsWith("/retry")) {
          expect(request.postDataJSON()).toEqual({ generation: 1 });
          generation = 2;
          state = "queued";
        } else {
          expect(request.postDataJSON()).toEqual({
            slug: "synthetic",
            legal_name: "Rede sintética",
            cnpj: "ABCDEFGHIJKL00",
            plan_id: id,
          });
          created = true;
          state = "queued";
        }
        return route.fulfill({
          status: 202,
          headers,
          body: JSON.stringify(network()),
        });
      });
      await page.goto(origin);
      if (support)
        await page.getByRole("button", { name: "Alternar menu" }).click();
      await page.getByRole("link", { name: "Redes", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Redes", exact: true }),
      ).toBeVisible();
      if (support) {
        await expect(
          page.getByText("Acesso de suporte: somente leitura."),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Nova rede", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "Tentar preparar novamente",
            exact: true,
          }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Tema escuro", exact: true })
          .click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(writes).toBe(0);
        return;
      }
      await page
        .getByRole("button", { name: "Nova rede", exact: true })
        .click();
      await page.getByLabel("Nome da rede").fill("Rede sintética");
      await page.getByLabel("Identificador").fill("synthetic");
      await page.getByLabel("CNPJ sem pontuação").fill("ABCDEFGHIJKL00");
      await page.getByLabel("Plano", { exact: true }).selectOption(id);
      await page
        .getByRole("button", { name: "Cadastrar rede", exact: true })
        .click();
      await expect(page.getByText("Na fila", { exact: true })).toBeVisible();
      state = "failed";
      await page
        .getByRole("button", { name: "Atualizar redes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Tentar preparar novamente", exact: true })
        .click();
      await expect(page.getByText("Na fila", { exact: true })).toBeVisible();
      state = "ready";
      await page
        .getByRole("button", { name: "Atualizar redes", exact: true })
        .click();
      await expect(page.getByText("Pronta", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Banco isolado confirmado · versão 1", {
          exact: true,
        }),
      ).toBeVisible();
      status = "suspended";
      state = "failed";
      await page
        .getByRole("button", { name: "Atualizar redes", exact: true })
        .click();
      await expect(page.getByText("Suspensa", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Tentar preparar novamente",
          exact: true,
        }),
      ).toHaveCount(0);
      expect(writes).toBe(2);
      expect(
        await page.evaluate(() => ({
          local: Object.keys(localStorage),
          session: Object.keys(sessionStorage),
        })),
      ).toEqual({ local: [], session: [] });
    },
  );
}

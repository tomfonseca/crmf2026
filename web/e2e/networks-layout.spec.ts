import { expect, test } from "@playwright/test";
const origin = "http://localhost:5177";
const id = "00000000-0000-7000-8000-000000000001";
test("Redes matches reference composition, setup and five addressable tabs", async ({
  page,
}) => {
  let writes = 0;
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    };
    if (route.request().method() !== "GET") {
      writes++;
      return route.fulfill({ status: 500, headers });
    }
    const network = {
      id,
      slug: "synthetic",
      legal_name: "Rede sintética",
      cnpj: "ABCDEFGHIJKL00",
      plan_id: id,
      plan_name: "Plano sintético",
      status: "trial",
      provision_status: "ready",
      schema_version: 1,
      generation: 1,
    };
    return route.fulfill({
      headers,
      json: path.endsWith("/me")
        ? {
            user_id: id,
            realm: "platform",
            store_ids: [],
            grants: [{ role: "platform_admin" }],
          }
        : {
            items: path.endsWith("/plans")
              ? [
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
                ]
              : [network],
          },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/tenants");
  await expect(page.getByRole("columnheader")).toHaveText([
    "Rede",
    "Plano",
    "Assinatura",
    "Lojas",
    "Dispositivos",
    "Preparação",
    "Criada em",
  ]);
  const create = page.getByRole("button", {
    name: "Cadastrar rede",
    exact: true,
  });
  await expect(create).toBeVisible();
  await page.screenshot({
    path: "test-results/networks-reference-list.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tema escuro", exact: true }).click();
  await page.screenshot({
    path: "test-results/networks-reference-list-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tema claro", exact: true }).click();
  await create.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Cadastrar rede",
  );
  await expect(page.locator(".networks-card > header h2")).toHaveText([
    "Identificação",
    "Dados cadastrais",
    "Contato comercial",
    "Assinatura",
  ]);
  const cards = await page
    .locator(".networks-form-grid > section")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }),
    );
  expect(cards[0].y).toBe(cards[1].y);
  expect(cards[2].y).toBeGreaterThan(cards[0].y);
  expect(cards[0].width).toBeGreaterThan(400);
  await page.screenshot({
    path: "test-results/networks-reference-create.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1024, height: 1000 });
  const tablet = await page
    .locator(".networks-form-grid > section")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(tablet[1]).toBeGreaterThan(tablet[0]);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Tema escuro", exact: true }).click();
  await page.screenshot({
    path: "test-results/networks-reference-create-dark-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".networks-card").first()).toHaveCSS(
    "background-color",
    "rgb(38, 38, 38)",
  );
  await expect(page.locator(".auth-app")).toHaveCSS(
    "background-color",
    "rgb(23, 23, 23)",
  );
  await page.screenshot({
    path: "test-results/networks-reference-create-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tema claro", exact: true }).click();
  await expect(
    page.getByLabel("Nome do contato", { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Nome da rede", { exact: true })
    .fill("Rascunho não salvo");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toContainText("rede");
  await page.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page.getByLabel("Nome da rede", { exact: true })).toHaveValue(
    "Rascunho não salvo",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Descartar", exact: true }).click();
  await page.getByRole("link", { name: "Rede sintética", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveText([
    "Dados cadastrais",
    "Assinatura e plano",
    "Lojas",
    "Usuários",
    "Eventos de cobrança",
  ]);
  await page.screenshot({
    path: "test-results/networks-reference-detail.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tema escuro", exact: true }).click();
  await page.screenshot({
    path: "test-results/networks-reference-detail-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tema claro", exact: true }).click();
  await page.getByRole("tab", { name: "Assinatura e plano" }).click();
  await expect(page).toHaveURL(/aba=assinatura/);
  await expect(
    page.getByRole("heading", { name: "Limites e módulos efetivos" }),
  ).toBeVisible();
  const subscriptionCards = await page
    .locator(".networks-detail-stack > section")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(subscriptionCards[0]).toBe(subscriptionCards[1]);
  expect(subscriptionCards[2]).toBeGreaterThan(subscriptionCards[0]);
  await expect(page.getByRole("rowheader")).toHaveText([
    "Máximo de lojas",
    "Máximo de usuários",
    "Histórico",
    "Sincronização",
    "Módulos",
  ]);
  await page
    .getByRole("tab", { name: "Assinatura e plano" })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Lojas", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(/aba=lojas/);
  for (const name of ["Usuários", "Eventos de cobrança", "Dados cadastrais"])
    await page.getByRole("tab", { name, exact: true }).click();
  await page.getByRole("link", { name: "Ver etapas" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Preparação da rede",
  );
  await expect(page.locator(".networks-steps > li")).toHaveCount(5);
  await expect(page.locator(".networks-steps > li").last()).toContainText(
    "Previsto",
  );
  await expect(
    page.getByText("Banco isolado confirmado · versão 1", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/networks-reference-setup.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tema escuro", exact: true }).click();
  await page.screenshot({
    path: "test-results/networks-reference-setup-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/networks-reference-setup-dark-mobile.png",
    fullPage: true,
  });
  expect(writes).toBe(0);
});

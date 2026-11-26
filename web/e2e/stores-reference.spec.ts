import { expect, test } from "@playwright/test";
const origin = "http://localhost:5177";
test("store reference boards share the actual presentation at desktop/mobile and never call APIs", async ({
  page,
}) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/v1/")) requests.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/__qg-design");
  const select = page.getByLabel("Prancheta");
  for (const [name, file] of [
    ["list", "QG-Lojas"],
    ["form", "QG-Loja-Form"],
    ["detail", "QG-Loja"],
  ]) {
    for (const dark of [false, true]) {
      await select.selectOption(file + (dark ? "--tema-escuro" : "") + ".html");
      await expect(page.locator(".stores-page")).toBeVisible();
      await page.locator(".qg-shell").screenshot({
        path: `test-results/stores-reference-${name}${dark ? "-dark" : ""}.png`,
      });
      if (dark)
        await expect(page.locator(".auth-app")).toHaveCSS(
          "background-color",
          "rgb(23, 23, 23)",
        );
    }
  }
  await select.selectOption("QG-Loja-Form.html");
  const cards = await page
    .locator(".stores-form-grid > section")
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width };
      }),
    );
  expect(cards).toHaveLength(3);
  expect(cards[0].y).toBe(cards[1].y);
  expect(cards[2].x).toBe(cards[0].x);
  expect(cards[2].y).toBeGreaterThan(cards[0].y);
  expect(cards[0].width).toBeGreaterThan(400);
  await expect(
    page.getByRole("button", { name: "Salvar loja", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 1024, height: 1000 });
  const ys = await page
    .locator(".stores-form-grid > section")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(ys[1]).toBeGreaterThan(ys[0]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await select.selectOption("QG-Loja-Form--modo-editar.html");
  await expect(page.getByLabel("Rede", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Nome", { exact: true })).not.toHaveValue("");
  await select.selectOption("QG-Loja.html");
  const detail = await page
    .locator(".stores-details-grid > section")
    .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().y));
  expect(detail[0]).toBe(detail[1]);
  await expect(page.locator(".stores-table-card")).toHaveCount(1);
  await expect(
    page.locator(".stores-table-card").getByRole("columnheader"),
  ).toHaveText(["Lote", "Fluxo", "Janela de dados", "Situação"]);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const file of [
      "QG-Lojas.html",
      "QG-Loja-Form.html",
      "QG-Loja.html",
      "QG-Loja--tema-escuro.html",
    ]) {
      await select.selectOption(file);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        file + " " + width,
      ).toBe(true);
    }
  }
  await page.screenshot({
    path: "test-results/stores-reference-detail-dark-mobile.png",
    fullPage: true,
  });
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
test("support store deep links remain read only and never request unchecked identities", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    const req = route.request();
    requests.push(req.method() + " " + new URL(req.url()).pathname);
    await route.fulfill({
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      },
      json: {
        realm: "platform",
        user_id: "00000000-0000-7000-8000-000000000001",
        store_ids: [],
        grants: [{ role: "platform_support" }],
      },
    });
  });
  for (const path of [
    "/stores",
    "/stores/new",
    "/stores/unverified/edit",
    "/stores/unverified",
  ]) {
    await page.goto(origin + path);
    await expect(
      page.getByText("Acesso de suporte: somente leitura.", { exact: true }),
    ).toBeVisible();
    for (const name of [
      "Cadastrar loja",
      "Salvar loja",
      "Editar",
      "Gerar código de pareamento",
      "Reinstalar agente",
    ])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
  }
  expect(
    requests.every((r) => ["GET /v1/hq/me", "GET /v1/hq/stores"].includes(r)),
  ).toBe(true);
});

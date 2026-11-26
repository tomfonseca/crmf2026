import { expect, test } from "@playwright/test";
const origin = "http://localhost:5177",
  id = "00000000-0000-7000-8000-000000000001";
test("Planos matches reference composition, dialogs and draft protection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  let writes = 0;
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "content-type,x-crmf-request",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE",
      "Content-Type": "application/json",
    };
    if (r.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (r.method() !== "GET") writes++;
    return route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify(
        path.endsWith("/me")
          ? {
              realm: "platform",
              user_id: id,
              store_ids: [],
              grants: [{ role: "platform_admin" }],
            }
          : {
              items: [
                {
                  id,
                  code: "exemplo-a",
                  name: "Plano exemplo A",
                  price_cents: 2990,
                  active: true,
                  sync_interval_seconds: 3600,
                  history_months: 12,
                  max_stores: 5,
                  max_users: null,
                  modules: ["core", "export"],
                  version: 1,
                },
                {
                  id: "00000000-0000-7000-8000-000000000002",
                  code: "exemplo-b",
                  name: "Plano exemplo B",
                  price_cents: 5990,
                  active: true,
                  sync_interval_seconds: 180,
                  history_months: 24,
                  max_stores: null,
                  max_users: null,
                  modules: ["core", "realtime", "export", "pulse"],
                  version: 1,
                },
                {
                  id: "00000000-0000-7000-8000-000000000003",
                  code: "exemplo-c",
                  name: "Plano exemplo C",
                  price_cents: 0,
                  active: false,
                  sync_interval_seconds: 86400,
                  history_months: 6,
                  max_stores: 1,
                  max_users: 5,
                  modules: ["core"],
                  version: 1,
                },
              ],
            },
      ),
    });
  });
  await page.goto(origin + "/plans");
  const h1 = page.getByRole("heading", { name: "Planos", exact: true });
  await expect(h1).toBeVisible();
  const create = page.getByRole("button", {
    name: "Cadastrar plano",
    exact: true,
  });
  expect((await create.boundingBox())!.x).toBeGreaterThan(
    (await h1.boundingBox())!.x + 500,
  );
  await expect(
    page.getByPlaceholder("Buscar por nome ou código"),
  ).toBeVisible();
  await expect(page.locator(".plans-table-footer")).toBeVisible();
  await page.screenshot({
    path: "test-results/plans-reference-list.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Editar Plano exemplo A", exact: true })
    .click();
  await expect(page.locator(".plans-form-card")).toHaveCount(5);
  const cards = page.locator(".plans-form-card");
  const boxes = await cards.evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    }),
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[1].y).toBe(boxes[2].y);
  expect(boxes[2].x).toBeGreaterThan(boxes[1].x);
  expect(boxes[3].x).toBe(boxes[0].x);
  await expect(page.getByRole("switch", { name: "Plano ativo" })).toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Editar plano", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "test-results/plans-reference-edit.png",
    fullPage: true,
  });
  await page.getByLabel("Nome", { exact: true }).fill("Rascunho não salvo");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  let dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Descartar alterações?" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/plans-reference-discard.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "Rascunho não salvo",
  );
  await page.getByRole("link", { name: "Lojas", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "Rascunho não salvo",
  );
  await page.goBack();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page).toHaveURL(origin + "/plans/" + id);
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "Rascunho não salvo",
  );
  await page.goBack();
  await page.getByRole("button", { name: "Descartar", exact: true }).click();
  await expect(h1).toBeVisible();
  await page
    .getByRole("button", { name: "Excluir Plano exemplo A", exact: true })
    .click();
  dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("heading", { name: "Excluir plano", exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("button", { name: "Excluir plano", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Excluir plano", exact: true }),
  ).toHaveCSS("background-color", "rgb(214, 57, 57)");
  await page.screenshot({
    path: "test-results/plans-reference-delete.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await create.click();
  await page.getByLabel("Nome", { exact: true }).fill("Novo rascunho");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Descartar", exact: true }).click();
  expect(writes).toBe(0);
  await create.click();
  for (const width of [1024, 360, 320]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/plans-reference-create-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.getByRole("button", { name: "Tema escuro", exact: true }).click();
  await expect(page.locator(".plans-form-card").first()).toHaveCSS(
    "background-color",
    "rgb(28, 28, 28)",
  );
  await page.screenshot({
    path: "test-results/plans-reference-create-dark.png",
    fullPage: true,
  });
});

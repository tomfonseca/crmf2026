import { expect, test } from "@playwright/test";
const origin = "http://localhost:5177";
const id = "00000000-0000-7000-8000-000000000001";
test("store API outage preserves drafts and never becomes an empty catalog or fabricated telemetry", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    requests.push(req.method() + " " + path);
    expect(req.method()).toBe("GET");
    expect(["/v1/hq/me", "/v1/hq/tenants", "/v1/hq/stores"]).toContain(path);
    if (path === "/v1/hq/stores")
      return route.fulfill({
        status: 503,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
        },
        json: { type: "store_unavailable" },
      });
    return route.fulfill({
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      },
      json: path.endsWith("/me")
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
                slug: "synthetic",
                legal_name: "Rede sintética",
                cnpj: "ABCDEFGHIJKL00",
                plan_id: id,
                plan_name: "Plano sintético",
                status: "trial",
                provision_status: "ready",
                schema_version: 1,
                generation: 1,
              },
            ],
          },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/stores");
  await expect(page.getByRole("columnheader")).toHaveText([
    "Loja",
    "Rede",
    "Cidade/UF",
    "ERP",
    "Dados",
    "Agente",
    "Última atualização",
  ]);
  await expect(
    page.getByText("Não foi possível carregar as lojas.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/0 lojas/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cadastrar loja", exact: true })
    .click();
  await expect(page.locator(".stores-card > header h2")).toHaveText([
    "Identificação",
    "Localização",
    "Integração",
  ]);
  await page.getByLabel("Rede", { exact: true }).selectOption(id);
  await page.getByLabel("Código da loja", { exact: true }).fill("S001");
  await page.getByLabel("Nome", { exact: true }).fill("Rascunho de loja");
  await expect(
    page.getByRole("button", { name: "Salvar loja", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("nesta loja");
  await page.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "Rascunho de loja",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Descartar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lojas", exact: true }),
  ).toBeVisible();
  await page.goto(origin + "/stores/unverified/edit");
  await expect(
    page.getByRole("heading", { name: "Editar loja", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Rede", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("");
  await page.goto(origin + "/stores/unverified");
  await expect(
    page.getByRole("heading", { name: "Dados da loja", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agente", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Últimos lotes", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Saudável", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Sem dados recebidos", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("unverified", { exact: true })).toHaveCount(0);
  expect(requests.every((r) => r.startsWith("GET "))).toBe(true);
  expect(
    await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })),
  ).toEqual({ local: [], session: [] });
});

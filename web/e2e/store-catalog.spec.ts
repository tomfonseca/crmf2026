import { test, expect } from "@playwright/test";
const origin = "http://localhost:5177",
  id = "00000000-0000-7000-8000-000000000001";
test("Store catalog saves real contracts, preserves quota-failed drafts and never invents telemetry", async ({
  page,
}) => {
  let writes = 0,
    version = 0,
    allowCreate = false;
  let store = {
    id,
    tenant_id: id,
    network_name: "Rede sintética",
    network_slug: "synthetic",
    code: "S001",
    name: "Loja sintética",
    city: "Cidade sintética",
    uf: "AM",
    timezone: "America/Manaus",
    erp: "linx_big",
    status: "active",
    version: 1,
  };
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      };
    requests.push(req.method() + " " + path);
    if (req.method() === "GET")
      return route.fulfill({
        headers,
        json: path.endsWith("/me")
          ? {
              user_id: id,
              realm: "platform",
              store_ids: [],
              grants: [{ role: "platform_admin" }],
            }
          : path === "/v1/hq/tenants"
            ? {
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
                    profile: {
                      version: 1,
                      data: {
                        display_name: "Rede sintética",
                        registered_name: "",
                        city: "",
                        uf: "",
                        contact_name: "",
                        contact_email: "",
                        default_timezone: "America/Manaus",
                        billing_customer_id: "",
                      },
                    },
                  },
                ],
              }
            : path === "/v1/hq/stores"
              ? { items: version ? [store] : [] }
              : store,
      });
    expect(req.headers()["x-crmf-request"]).toBe("1");
    const body = req.postDataJSON();
    writes++;
    if (req.method() === "POST") {
      expect(body).toEqual({
        tenant_id: id,
        code: "S001",
        name: "Loja sintética",
        city: "Cidade sintética",
        uf: "AM",
        timezone: "America/Manaus",
        erp: "linx_big",
        status: "active",
      });
      if (!allowCreate)
        return route.fulfill({
          status: 409,
          headers,
          json: { type: "plan_limit" },
        });
      version = 1;
      return route.fulfill({ status: 201, headers, json: store });
    }
    expect(req.method()).toBe("PUT");
    expect(path).toBe("/v1/hq/stores/" + id);
    expect(body).toEqual({
      code: "S001",
      name: "Loja editada",
      city: "Cidade sintética",
      uf: "AM",
      timezone: "America/Manaus",
      erp: "linx_big",
      status: "inactive",
      version: 1,
    });
    expect(body).not.toHaveProperty("tenant_id");
    version = 2;
    store = { ...store, ...body, version };
    return route.fulfill({ headers, json: store });
  });
  await page.goto(origin + "/stores");
  await expect(
    page.getByText("Nenhuma loja cadastrada", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cadastrar loja", exact: true })
    .click();
  await page.getByLabel("Rede", { exact: true }).selectOption(id);
  await expect(page.getByLabel("Fuso horário", { exact: true })).toHaveValue(
    "America/Manaus",
  );
  await page.getByLabel("Código da loja", { exact: true }).fill("S001");
  await page.getByLabel("Nome", { exact: true }).fill("Loja sintética");
  await page.getByLabel("Cidade", { exact: true }).fill("Cidade sintética");
  await page.getByLabel("UF", { exact: true }).selectOption("AM");
  await page.getByRole("button", { name: "Salvar loja", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "O limite de lojas do plano foi atingido",
  );
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue(
    "Loja sintética",
  );
  expect(writes).toBe(1);
  allowCreate = true;
  await page.getByRole("button", { name: "Salvar loja", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/stores/" + id + "$"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Loja sintética",
  );
  for (const text of [
    "Saudável",
    "Offline",
    "Sem dados recebidos",
    "Aguardando pareamento",
    "Nenhum dispositivo pareado",
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Consulta de lotes ainda não disponível.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByLabel("Rede", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Rede", { exact: true })).toHaveValue(id);
  await page.getByLabel("Nome", { exact: true }).fill("Loja editada");
  await page.getByLabel("Situação", { exact: true }).selectOption("inactive");
  await page.getByRole("button", { name: "Salvar loja", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Loja editada",
  );
  await expect(page.getByText("Inativa", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Rede sintética", exact: true }).click();
  await page.getByRole("tab", { name: "Lojas", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Lojas da rede" })
      .getByRole("link", { name: "Loja editada", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Lojas da rede" })
      .getByRole("columnheader"),
  ).toHaveText([
    "Loja",
    "Cidade/UF",
    "ERP",
    "Dados",
    "Dispositivo",
    "Última atualização",
  ]);
  expect(writes).toBe(3);
  expect(version).toBe(2);
  expect(requests.filter((r) => r.startsWith("POST "))).toHaveLength(2);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })),
  ).toEqual({ local: [], session: [] });
});

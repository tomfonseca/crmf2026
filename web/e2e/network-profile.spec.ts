import { test, expect } from "@playwright/test";
const origin = "http://localhost:5177",
  id = "00000000-0000-7000-8000-000000000001";
test("Network CNPJ suggestions persist with commercial fields and optimistic editing", async ({
  page,
}) => {
  const empty = {
    display_name: "",
    registered_name: "",
    city: "",
    uf: "",
    contact_name: "",
    contact_email: "",
    default_timezone: "",
    billing_customer_id: "",
  };
  let saved = { ...empty },
    version = 0,
    created = false,
    writes = 0,
    lookups = 0;
  const network = () => ({
    id,
    slug: "synthetic",
    legal_name: "Rede manual",
    cnpj: "00000000000191",
    plan_id: id,
    plan_name: "Plano sintético",
    status: "trial",
    provision_status: "queued",
    schema_version: 0,
    generation: 1,
    profile: { data: saved, version },
  });
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      };
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
          : path.includes("/companies/")
            ? (lookups++,
              {
                ...empty,
                display_name: "Nome fantasia sugerido",
                registered_name: "Razão sintética consultada",
                city: "Cidade sintética",
                uf: "SP",
              })
            : {
                items: path.endsWith("/plans")
                  ? [
                      {
                        id,
                        code: "synthetic",
                        name: "Plano sintético",
                        active: true,
                        price_cents: 0,
                        sync_interval_seconds: 180,
                        history_months: 12,
                        max_stores: 1,
                        max_users: null,
                        modules: ["core"],
                        version: 1,
                      },
                    ]
                  : created
                    ? [network()]
                    : [],
              },
      });
    expect(req.headers()["x-crmf-request"]).toBe("1");
    const body = req.postDataJSON();
    writes++;
    if (req.method() === "POST") {
      expect(body).toEqual({
        slug: "synthetic",
        legal_name: "Rede manual",
        cnpj: "00000000000191",
        plan_id: id,
        profile: {
          display_name: "Rede manual",
          registered_name: "Razão sintética consultada",
          city: "Cidade sintética",
          uf: "SP",
          contact_name: "Contato comercial sintético",
          contact_email: "contact@example.invalid",
          default_timezone: "America/Manaus",
          billing_customer_id: "cus_synthetic",
        },
      });
      saved = body.profile;
      version = 1;
      created = true;
      return route.fulfill({ status: 202, headers, json: network() });
    }
    expect(req.method()).toBe("PUT");
    expect(path).toBe(`/v1/hq/tenants/${id}/profile`);
    expect(body.version).toBe(1);
    expect(body.data.contact_email).toBe("new@example.invalid");
    expect(body).not.toHaveProperty("slug");
    expect(body).not.toHaveProperty("cnpj");
    saved = body.data;
    version = 2;
    return route.fulfill({ headers, json: { data: saved, version } });
  });
  await page.goto(origin + "/tenants/new");
  await page.getByLabel("Nome da rede", { exact: true }).fill("Rede manual");
  await page.getByLabel("Identificador", { exact: true }).fill("synthetic");
  await page
    .getByLabel("CNPJ sem pontuação", { exact: true })
    .fill("00.000.000/0001-91");
  await expect(page.getByLabel("Razão social", { exact: true })).toHaveValue(
    "Razão sintética consultada",
  );
  await expect(page.getByLabel("Nome da rede", { exact: true })).toHaveValue(
    "Rede manual",
  );
  await expect(page.getByLabel("Cidade", { exact: true })).toHaveValue(
    "Cidade sintética",
  );
  await expect(page.getByLabel("UF", { exact: true })).toHaveValue("SP");
  await page
    .getByLabel("Nome do contato", { exact: true })
    .fill("Contato comercial sintético");
  await page
    .getByLabel("E-mail do contato", { exact: true })
    .fill("contact@example.invalid");
  await page
    .getByLabel("Fuso horário padrão das lojas", { exact: true })
    .selectOption("America/Manaus");
  await page
    .getByLabel("Identificador de cobrança (opcional)", { exact: true })
    .fill("cus_synthetic");
  await page.getByLabel("Plano", { exact: true }).selectOption(id);
  await page
    .getByRole("button", { name: "Cadastrar e preparar", exact: true })
    .click();
  await expect(page).toHaveURL(/synthetic\/setup$/);
  await page.goto(origin + "/tenants/synthetic?aba=dados");
  await expect(
    page.getByText("Razão sintética consultada", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(
    page.getByLabel("CNPJ sem pontuação", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Identificador", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Plano", { exact: true })).toBeDisabled();
  await page
    .getByLabel("E-mail do contato", { exact: true })
    .fill("new@example.invalid");
  await page
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(page).not.toHaveURL(/editar/);
  await expect(page.getByText(/new@example.invalid/)).toBeVisible();
  expect(writes).toBe(2);
  expect(lookups).toBe(1);
  expect(
    await page.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })),
  ).toEqual({ local: [], session: [] });
});

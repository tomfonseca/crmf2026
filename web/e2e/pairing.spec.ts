import { test, expect } from "@playwright/test";
const origin = "http://localhost:5177",
  id = "00000000-0000-7000-8000-000000000001",
  key = "00000000-0000-7000-8000-000000000002";
test("pairing emits only on confirmation, erases secret, checks revision, revokes and never installs a device", async ({
  page,
}) => {
  let current: object | undefined,
    issues = 0,
    revokes = 0,
    version = 1,
    denied = false,
    support = false;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
  };
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname;
    if (r.method() === "GET")
      return route.fulfill({
        headers,
        json: path.endsWith("/me")
          ? {
              user_id: id,
              realm: "platform",
              store_ids: [],
              grants: [
                { role: support ? "platform_support" : "platform_admin" },
              ],
            }
          : path.endsWith("/pairing")
            ? current
              ? { current }
              : {}
            : {
                id,
                tenant_id: id,
                network_slug: "synthetic",
                network_name: "Rede sintética",
                code: "S001",
                name: "Loja sintética",
                city: "",
                uf: "",
                timezone: "America/Manaus",
                erp: "linx_big",
                status: "active",
                version,
              },
      });
    expect(r.headers()["x-crmf-request"]).toBe("1");
    expect(support).toBe(false);
    if (r.method() === "POST") {
      issues++;
      expect(r.postDataJSON()).toEqual({
        store_version: version,
        previous_id: current ? key : "",
      });
      if (denied)
        return route.fulfill({
          headers,
          status: 409,
          json: { type: "pairing_conflict" },
        });
      current = {
        id: key,
        store_id: id,
        status: "pending",
        expires_at: "2026-12-01T12:00:00Z",
      };
      return route.fulfill({
        headers,
        status: 201,
        json: { current, code: "ABCD2345" },
      });
    }
    if (r.method() === "DELETE") {
      revokes++;
      expect(path.endsWith("/pairing/" + key)).toBe(true);
      current = { ...current, status: "revoked" };
      return route.fulfill({ headers, status: 204 });
    }
    throw Error("unexpected business endpoint");
  });
  await page.goto(origin + "/stores/" + id);
  await page
    .getByRole("button", { name: "Códigos de pareamento", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parear dispositivo", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Nenhum código emitido para esta loja.", { exact: true }),
  ).toBeVisible();
  expect(issues).toBe(0);
  await page.getByRole("button", { name: "Gerar código", exact: true }).click();
  expect(issues).toBe(0);
  await page
    .getByRole("button", { name: "Confirmar emissão", exact: true })
    .click();
  await expect(
    page.getByLabel("Código de pareamento", { exact: true }),
  ).toHaveText("ABCD-2345");
  await expect(
    page.getByRole("button", {
      name: "Baixar instalador · Previsto",
      exact: true,
    }),
  ).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(
    page.getByLabel("Código de pareamento", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Voltar à loja", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Códigos de pareamento", exact: true })
    .click();
  await expect(
    page.getByText("O código não pode ser recuperado.", { exact: true }),
  ).toBeVisible();
  expect(issues).toBe(1);
  await page
    .getByRole("button", { name: "Revogar código", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar revogação", exact: true })
    .click();
  await expect(page.getByText("Revogado", { exact: true })).toBeVisible();
  expect(revokes).toBe(1);
  denied = true;
  await page
    .getByRole("button", { name: "Gerar novo código", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar emissão", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Atualize antes de continuar",
  );
  await expect(
    page.getByRole("button", { name: "Gerar novo código", exact: true }),
  ).toBeDisabled();
  version = 2;
  await page
    .getByRole("button", { name: "Atualizar dados", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Gerar novo código", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Gerar novo código", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirmar emissão", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Atualize antes de continuar",
  );
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("ABCD2345");
  expect(
    await page.evaluate(() =>
      Object.keys({ ...localStorage, ...sessionStorage }),
    ),
  ).toEqual([]);
  support = true;
  await page.reload();
  await expect(
    page.getByText("Somente administradores podem emitir ou revogar códigos.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Gerar novo código", exact: true }),
  ).toHaveCount(0);
  expect(issues).toBe(3);
  expect(errors).toEqual([]);
});

import { expect, test } from "@playwright/test";
test("desktop: local charts, store filters, navigation, CSV and no backend requests", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const backend: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.url().includes("/v1/") ||
      ["8080", "3307"].includes(new URL(request.url()).port)
    )
      backend.push(request.url());
  });
  await page.goto("/meu-desempenho");
  await expect(
    page.getByRole("heading", { name: "Meu desempenho" }),
  ).toBeVisible();
  await expect(page.locator(".chart svg").first()).toBeVisible();
  await page.screenshot({
    path: info.outputPath("desempenho-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Minhas lojas", exact: true }).click();
  await page.getByRole("button", { name: /Todas as lojas/ }).click();
  await expect(page).toHaveURL(/store=all/);
  await page.getByRole("link", { name: "Minhas metas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Minhas metas" }),
  ).toBeVisible();
  await expect(page.locator(".chart svg").first()).toBeVisible();
  await expect(page.getByText("1–6 de 12 registros")).toBeVisible();
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page.getByText("7–12 de 12 registros")).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Buscar na tabela" })
    .fill("genéricos");
  await expect(page.getByText("1–2 de 2 registros")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain("metas-demo-all");
  await page.screenshot({
    path: info.outputPath("metas-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Usar tema claro" }).click();
  await expect(page.locator(".dashboard")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await page.reload();
  await expect(page.locator(".dashboard")).toHaveAttribute(
    "data-theme",
    "light",
  );
  expect(errors).toEqual([]);
  expect(backend).toEqual([]);
});
test("direct links, browser history, scenarios, date filters and recovery", async ({
  page,
}) => {
  await page.goto("/minhas-metas?store=904&from=2026-10-01&to=2026-10-31");
  await expect(page.getByLabel("Data inicial")).toHaveValue("2026-10-01");
  await expect(
    page.getByText("Período encerrado: confira seu resultado"),
  ).toBeVisible();
  await page.getByLabel("Data inicial").fill("2026-11-01");
  await page.getByLabel("Data final").fill("2026-11-30");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL(/from=2026-11-01/);
  await page.goBack();
  await expect(page.getByLabel("Data inicial")).toHaveValue("2026-10-01");
  await page.getByLabel("Cenário da demonstração").selectOption("empty");
  await expect(
    page.getByText("Sem vendas no período", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Cenário da demonstração").selectOption("no-base");
  await expect(
    page.getByText("Ainda não existe meta cadastrada para este período"),
  ).toBeVisible();
  await page.getByLabel("Cenário da demonstração").selectOption("loading");
  await expect(page.getByRole("status")).toContainText(
    "Carregando demonstração",
  );
  await page.getByLabel("Cenário da demonstração").selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Erro simulado");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("heading", { name: "Distribuição de vendas" }),
  ).toBeVisible();
  await expect(page.getByLabel("Cenário da demonstração")).toHaveValue(
    "populated",
  );
});
test("mobile 360px: responsive shell, keyboard dismissal, light theme and alternative tables", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/meu-desempenho");
  await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page.getByRole("link", { name: "Minhas metas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Minhas metas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Abrir navegação" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Minhas lojas", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Minhas lojas" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Minhas lojas" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Minhas lojas", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Usar tema claro" }).click();
  await page.getByText("Ver distribuição em tabela", { exact: true }).click();
  await expect(
    page.getByRole("table", { name: "Vendas fictícias por grupo" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("metas-mobile-light.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Documentação", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sobre esta demonstração" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Sobre esta demonstração" }),
  ).not.toBeVisible();
});

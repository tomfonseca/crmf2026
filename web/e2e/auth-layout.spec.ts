import { expect, test } from "@playwright/test";
import { authReferenceTitles } from "./auth-reference-titles";
test("all 94 supplied auth boards render without API requests or horizontal overflow", async ({
  page,
}) => {
  test.slow(); // 188 board/viewport combinations, not a single-screen timing test.
  const errors: string[] = [];
  const api: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("localhost:8080")) api.push(request.url());
  });
  await page.goto("http://localhost:5177/__auth-design");
  const select = page.getByLabel("Prancheta");
  const names = await select.locator("option").allTextContents();
  expect(names).toHaveLength(94);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const name of names) {
      await select.selectOption(name);
      await expect(page.locator("main h1")).toHaveCount(1);
      await expect(page.locator("main h1")).toHaveText(
        authReferenceTitles[name],
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name,
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await select.selectOption("Login--estado-obrigatorios.html");
  await expect(page.getByText("Informe o e-mail.")).toBeVisible();
  await select.selectOption("QG-Login--tema-escuro.html");
  await expect(page.locator("main")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("QG", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/auth-layout-qg-dark.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(api).toEqual([]);
});
test("mobile login validates, reveals password, persists only theme and shows honest forgot-password state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  const mutations: string[] = [];
  await page.route("http://localhost:8080/**", async (route) => {
    if (route.request().method() !== "GET")
      mutations.push(route.request().method());
    await route.fulfill({
      status: 401,
      headers: {
        "Access-Control-Allow-Origin": "http://localhost:5177",
        "Access-Control-Allow-Credentials": "true",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  });
  await page.goto("http://localhost:5177/");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByText("Informe o e-mail.")).toBeVisible();
  await expect(page.getByLabel("E-mail", { exact: true })).toBeFocused();
  await page.getByLabel("Senha", { exact: true }).fill("not-a-real-password");
  await page
    .getByRole("button", { name: "Mostrar senha", exact: true })
    .click();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page
    .getByRole("button", { name: "Usar tema escuro", exact: true })
    .click();
  await expect(page.locator("main")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([
    ["crmf.auth.theme", "dark"],
  ]);
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("link", { name: "Esqueci minha senha", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Esqueci minha senha" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enviar link de redefinição" }),
  ).toBeDisabled();
  await expect(page.getByText(/Nenhum e-mail será enviado/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/auth-layout-forgot-mobile.png",
    fullPage: true,
  });
  expect(mutations).toEqual([]);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Entrar no QG", exact: true }),
  ).toBeVisible();
});

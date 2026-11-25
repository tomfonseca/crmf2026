import { expect, test } from "@playwright/test";
import { qgPreviewCases } from "../apps/hq/src/qg-preview-cases";
test("all 125 QG references render at desktop and 320px without API access", async ({
  page,
}) => {
  test.slow();
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/v1/")) requests.push(r.url());
  });
  await page.goto("http://localhost:5177/__qg-design");
  const select = page.getByLabel("Prancheta");
  expect(qgPreviewCases.length).toBe(125);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const entry of qgPreviewCases) {
      await select.selectOption(entry.file);
      await expect(page.locator("main h1")).toHaveText(entry.title);
      await expect(page.locator("h1")).toHaveCount(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        entry.file + " @" + width,
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await select.selectOption("QG-Painel.html");
  await page.screenshot({
    path: "test-results/qg-overview-light.png",
    fullPage: true,
  });
  await select.selectOption("QG-Dispositivo--tema-escuro.html");
  await page.screenshot({
    path: "test-results/qg-device-dark.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
test("operational routes require identity and never manufacture data or commands", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("http://localhost:8080/v1/hq/**", async (route) => {
    requests.push(
      route.request().method() + " " + new URL(route.request().url()).pathname,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        realm: "platform",
        user_id: "00000000-0000-7000-8000-000000000001",
        store_ids: [],
        grants: [{ role: "platform_support" }],
      }),
    });
  });
  await page.goto("http://localhost:5177/devices/example");
  await expect(
    page.getByRole("heading", { name: "Dispositivo", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText("Operação prevista", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Solicitar diagnóstico/ }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /Revogar/ })).toHaveCount(0);
  await expect(page.getByText("DEV-EXEMPLO", { exact: true })).toHaveCount(0);
  expect(requests.every((r) => r === "GET /v1/hq/me")).toBe(true);
});

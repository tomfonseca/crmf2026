import { expect, test } from "@playwright/test";
import { referenceNavigationIcons } from "../apps/hq/src/menu-icons.reference";
test("reference menu icons survive themes, collapse and mobile drawer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:5177/__qg-design");
  const nav = page.getByRole("navigation", { name: "Menu do QG" });
  async function verify() {
    for (const [url, paths] of Object.entries(referenceNavigationIcons)) {
      const link = nav.locator('a[href="' + url + '"]');
      const svg = link.locator("svg");
      await expect(svg).toBeVisible();
      await expect(svg).toHaveCSS("width", "20px");
      await expect(svg).toHaveCSS("height", "20px");
      expect(
        await svg
          .locator("path")
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("d"))),
      ).toEqual(paths);
      await expect(svg).toHaveCSS("stroke-linecap", "round");
      await expect(svg).toHaveCSS("stroke-linejoin", "round");
      expect(
        await svg.evaluate(
          (el) =>
            getComputedStyle(el).stroke ===
            getComputedStyle(el.parentElement!).color,
        ),
      ).toBe(true);
    }
  }
  await verify();
  expect(
    await page.locator(".qg-global-search input").evaluate((input) => {
      const icon = input.parentElement!.querySelector("svg")!;
      return (
        input.getBoundingClientRect().left +
          parseFloat(getComputedStyle(input).paddingLeft) >=
        icon.getBoundingClientRect().right + 4
      );
    }),
    "magnifier must not overlap the input text",
  ).toBe(true);
  await page.screenshot({
    path: "test-results/qg-icons-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Tema escuro", exact: true }).click();
  await verify();
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await expect(page.locator(".qg-user-chevron")).toHaveClass(/is-open/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Alternar menu" }).click();
  await verify();
  await expect(page.locator(".qg-sidebar .qg-doc svg")).toBeVisible();
  await expect(page.locator(".qg-sidebar .qg-doc")).toHaveAccessibleName(
    "Documentação",
  );
  await page.screenshot({
    path: "test-results/qg-icons-collapsed-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole("button", { name: "Alternar menu" }).click();
  await verify();
  await expect(page.locator(".qg-sidebar .qg-doc > span")).toBeVisible();
  await expect(page.locator(".qg-sidebar .qg-doc")).toHaveCSS(
    "display",
    "flex",
  );
  await page.screenshot({
    path: "test-results/qg-icons-mobile-dark.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".qg-sidebar")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

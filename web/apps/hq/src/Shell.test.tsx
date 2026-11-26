import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { Shell } from "./Shell";
import {
  referenceNavigationIcons,
  referenceShellIcons,
} from "./menu-icons.reference";
beforeEach(() => {
  localStorage.clear();
});
function shell(theme = "light") {
  return (
    <Shell
      path="/overview"
      navigate={vi.fn()}
      theme={theme}
      toggleTheme={vi.fn()}
      support={false}
    >
      <h1>Teste</h1>
    </Shell>
  );
}
function geometry(element: Element) {
  return [...element.querySelectorAll("svg path")].map((p) =>
    p.getAttribute("d"),
  );
}
test("every navigation icon matches its own supplied SVG, with no generic fallback", () => {
  render(shell());
  const nav = screen.getByRole("navigation", { name: "Menu do QG" });
  for (const [url, expected] of Object.entries(referenceNavigationIcons)) {
    const link = nav.querySelector('a[href="' + url + '"]')!;
    expect(link).not.toBeNull();
    expect(geometry(link), url).toEqual(expected);
    const svg = link.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("stroke-width", "1.75");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
  }
});
test("header and documentation use reference SVGs, not font glyphs", () => {
  render(shell());
  const controls = [
    ["Alternar menu", "menu"],
    ["Tema escuro", "moon"],
    ["Alertas — previsto", "bell"],
    ["Menu do usuário", "chevron"],
  ] as const;
  for (const [label, key] of controls)
    expect(
      geometry(screen.getByRole("button", { name: label })),
      label,
    ).toEqual(referenceShellIcons[key]);
  const sidebar = screen.getByRole("complementary", {
    name: "Navegação principal",
  });
  expect(
    geometry(within(sidebar).getByRole("link", { name: "Documentação" })),
  ).toEqual(referenceShellIcons.documentation);
  expect(screen.getByRole("banner").textContent).not.toMatch(/[☰☀☾♧⌄]/);
});
test("search has the reference magnifier at 16px", () => {
  render(shell());
  const label = screen
    .getByRole("textbox", { name: "Busca global — prevista" })
    .closest("label")!;
  expect(geometry(label)).toEqual([
    "M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0",
    "M21 21l-6 -6",
  ]);
  expect(label.querySelector("svg")).toHaveAttribute("width", "16");
  expect(label.querySelector("svg")).toHaveAttribute("height", "16");
});
test("dark theme selects the supplied sun SVG without changing control semantics", () => {
  render(shell("dark"));
  expect(geometry(screen.getByRole("button", { name: "Tema claro" }))).toEqual(
    referenceShellIcons.sun,
  );
});

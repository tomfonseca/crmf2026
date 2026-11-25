import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { OperationalScreen, routeFamily } from "./OperationalScreens";
import { parseMinutes } from "./Plans";
test("operational routes resolve every planned detail without exposing a data selector", () => {
  for (const [path, family] of [
    ["/overview", "overview"],
    ["/stores/new", "storeForm"],
    ["/stores/x/pairing", "pairing"],
    ["/stores/x/reinstall", "reinstall"],
    ["/devices/x", "device"],
    ["/batches/x", "batch"],
    ["/tenants/example/setup", "setup"],
  ])
    expect(routeFamily(path)).toBe(family);
});
test("minute conversion preserves positive integral seconds without rounding invalid input", () => {
  expect(parseMinutes("3")).toBe(180);
  expect(parseMinutes("0.5")).toBe(30);
  for (const bad of ["", "0", "-1", "abc", "0.0001", "99999999999"])
    expect(() => parseMinutes(bad)).toThrow();
});
test("production operational page cannot issue diagnostic commands or claim a healthy device", () => {
  render(<OperationalScreen family="device" navigate={vi.fn()} support />);
  expect(
    screen.getByRole("button", { name: /Solicitar diagnóstico/ }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /Revogar/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("DEV-EXEMPLO")).not.toBeInTheDocument();
  expect(screen.queryByText("Saudável")).not.toBeInTheDocument();
});
test("network tabs navigate with a shareable tab query but never edit an unvalidated identity", () => {
  const navigate = vi.fn();
  render(<OperationalScreen family="network" navigate={navigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Assinatura" }));
  expect(navigate).toHaveBeenCalledWith(
    window.location.pathname + "?aba=assinatura",
  );
  expect(screen.getByRole("button", { name: /Trocar plano/ })).toBeDisabled();
});

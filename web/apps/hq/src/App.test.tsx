import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";
test("renders the Portuguese foundation shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "QG CRMF" })).toBeInTheDocument();
});

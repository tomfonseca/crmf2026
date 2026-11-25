import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";
test("renders the Portuguese foundation shell", () => {
  render(<App />);
  expect(screen.getByText("CRM Farma")).toBeInTheDocument();
  expect(screen.getByText("QG")).toBeInTheDocument();
});

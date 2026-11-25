import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
// The router restores scroll positions; jsdom has no layout/scrolling.
window.scrollTo = vi.fn();
import { cleanup } from "@testing-library/react";
afterEach(cleanup);

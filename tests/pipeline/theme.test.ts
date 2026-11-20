// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeToggle } from "../../src/components/theme-toggle";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readStoredTheme,
  resolveTheme,
  toggleTheme,
  writeStoredTheme,
} from "../../src/lib/theme";

afterEach(() => {
  document.documentElement.className = "";
  window.localStorage.removeItem(THEME_STORAGE_KEY);
});

it("resolveTheme defaults to dark unless stored light", () => {
  expect(resolveTheme(null)).toBe("dark");
  expect(resolveTheme(undefined)).toBe("dark");
  expect(resolveTheme("")).toBe("dark");
  expect(resolveTheme("nope")).toBe("dark");
  expect(resolveTheme("dark")).toBe("dark");
  expect(resolveTheme("light")).toBe("light");
});

it("toggleTheme flips between dark and light", () => {
  expect(toggleTheme("dark")).toBe("light");
  expect(toggleTheme("light")).toBe("dark");
});

it("applyTheme sets exactly one mode class on the root", () => {
  applyTheme("light", document.documentElement);
  expect(document.documentElement.classList.contains("light")).toBe(true);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  applyTheme("dark", document.documentElement);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.classList.contains("light")).toBe(false);
});

it("read/writeStoredTheme round-trips through localStorage", () => {
  expect(readStoredTheme(window.localStorage)).toBe("dark");
  writeStoredTheme("light", window.localStorage);
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  expect(readStoredTheme(window.localStorage)).toBe("light");
});

it("ThemeToggle flips document class and localStorage", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.className = "dark";
  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(ThemeToggle));
    });
    const button = container.querySelector("button");
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await act(async () => {
      button!.click();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("two ThemeToggles stay in sync after one click", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.className = "dark";
  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ThemeToggle),
          React.createElement(ThemeToggle),
        ),
      );
    });
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    await act(async () => {
      buttons[0]!.click();
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "สลับเป็นโหมดมืด",
      "สลับเป็นโหมดมืด",
    ]);
    expect(container.querySelectorAll("svg.lucide-moon")).toHaveLength(2);
    expect(container.querySelectorAll("svg.lucide-sun")).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("storage event applies the stored theme on this document", async () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.className = "dark";
  window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(React.createElement(ThemeToggle));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "light" }));
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("สลับเป็นโหมดมืด");
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    });
    expect(document.documentElement.classList.contains("light")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { assetPath, dishImagePath } from "@/utils/assetPath";

describe("assetPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds path with root base URL", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(assetPath("restaurant/menu.json")).toBe("/restaurant/menu.json");
  });

  it("builds path with subpath base URL", () => {
    vi.stubEnv("BASE_URL", "/repository-name/");
    expect(assetPath("restaurant/menu.json")).toBe(
      "/repository-name/restaurant/menu.json",
    );
  });

  it("strips leading slashes from relative path", () => {
    vi.stubEnv("BASE_URL", "/repo/");
    expect(assetPath("/restaurant/assets/logo.svg")).toBe(
      "/repo/restaurant/assets/logo.svg",
    );
  });

  it("preserves external URLs", () => {
    vi.stubEnv("BASE_URL", "/repo/");
    expect(assetPath("https://pokeramen.ru/privacy/")).toBe(
      "https://pokeramen.ru/privacy/",
    );
  });

  it("builds dish image path by id", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(dishImagePath(1001)).toBe("/restaurant/assets/dishes/1001.webp");
  });
});

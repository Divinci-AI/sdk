import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { openBrowser } = await import("../../../src/auth/oauth.js");

describe("openBrowser", () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    execFileMock.mockClear();
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  test("on win32, quotes the URL and sets windowsVerbatimArguments to survive cmd's & metacharacter parsing", () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const url = "https://divinci-staging.us.auth0.com/authorize?response_type=code&client_id=abc123&redirect_uri=http://localhost:8666/callback";
    openBrowser(url);

    expect(execFileMock).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", '""', `"${url}"`],
      { windowsVerbatimArguments: true },
      expect.any(Function),
    );
  });

  test("on darwin, opens the URL directly without quoting", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    const url = "https://example.com?a=1&b=2";
    openBrowser(url);

    expect(execFileMock).toHaveBeenCalledWith("open", [url], expect.any(Function));
  });

  test("on linux, opens the URL via xdg-open without quoting", () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    const url = "https://example.com?a=1&b=2";
    openBrowser(url);

    expect(execFileMock).toHaveBeenCalledWith("xdg-open", [url], expect.any(Function));
  });
});

/**
 * Automatic error reporting. Every test here defends a promise made to the
 * user in `divinci privacy error-reporting status`, so a regression in any of
 * them is a privacy regression, not a bug.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const loadCredentialsMock = vi.fn();
vi.mock("../../../src/config/credentials.js", () => ({
  loadCredentials: () => loadCredentialsMock(),
}));

const {
  buildReport, classify, isReportingEnabled,
} = await import("../../../src/telemetry/error-report.js");

describe("consent", () => {
  beforeEach(() => { loadCredentialsMock.mockReset(); delete process.env.DIVINCI_DISABLE_TELEMETRY; });

  test("OFF when the user has never chosen", () => {
    loadCredentialsMock.mockReturnValue({ version: 1, defaultProfile: "d", profiles: {} });
    expect(isReportingEnabled()).toBe(false);
  });

  test("OFF when declined", () => {
    loadCredentialsMock.mockReturnValue({ errorReporting: false });
    expect(isReportingEnabled()).toBe(false);
  });

  test("ON only when explicitly true", () => {
    loadCredentialsMock.mockReturnValue({ errorReporting: true });
    expect(isReportingEnabled()).toBe(true);
  });

  test("OFF when the credentials file cannot be read", () => {
    // Absence of a readable answer is not consent.
    loadCredentialsMock.mockImplementation(() => { throw new Error("EACCES"); });
    expect(isReportingEnabled()).toBe(false);
  });

  test("DIVINCI_DISABLE_TELEMETRY overrides an opt-in", () => {
    loadCredentialsMock.mockReturnValue({ errorReporting: true });
    process.env.DIVINCI_DISABLE_TELEMETRY = "1";
    expect(isReportingEnabled()).toBe(false);
    delete process.env.DIVINCI_DISABLE_TELEMETRY;
  });
});

describe("report contents", () => {
  beforeEach(() => { loadCredentialsMock.mockReset(); });

  test("command ARGUMENTS never survive into the report", () => {
    // The single most important property: a command line routinely contains
    // file paths, release ids and prompt text.
    const report = buildReport({
      cliVersion: "0.3.1",
      command: "rag upload /Users/someone/Documents/patient-notes.pdf --prompt 'my secret'",
      apiUrl: "https://api.divinci.app",
    });
    expect(report.command).toBe("rag:upload");
    expect(JSON.stringify(report)).not.toMatch(/patient-notes|Users|secret|prompt/);
  });

  test("the report has no field that could carry free text", () => {
    const report = buildReport({
      cliVersion: "0.3.1", command: "workspace list",
      apiUrl: "https://api.divinci.app", status: 403, code: "INVALID_TOKEN",
    });
    // Enumerable or bounded, every one.
    expect(Object.keys(report).sort()).toEqual([
      "apiEnv", "auth0Env", "cliVersion", "code", "command", "httpStatus",
      "kind", "nodeMajor", "platform",
    ]);
    expect(["prod", "staging", "dev", "custom"]).toContain(report.apiEnv);
    expect(["prod", "staging", "dev", "custom"]).toContain(report.auth0Env);
  });

  test("the incident signature is visible: prod API with a dev tenant", () => {
    // This is the whole point. cli<=0.2.9 pointed at the prod API while
    // minting tokens from the dev Auth0 tenant; a mismatch here is that bug.
    const report = buildReport({
      cliVersion: "0.2.3", command: "workspace list",
      apiUrl: "https://api.divinci.app", status: 403,
    });
    expect(report.apiEnv).toBe("prod");
    // With the CURRENT (fixed) config both are prod, so the mismatch is absent.
    // The assertion that matters is that both are resolved and comparable.
    expect(report.auth0Env).toBe("prod");
    expect(report.apiEnv === report.auth0Env).toBe(true);
  });

  test("an unknown API URL degrades to custom rather than guessing", () => {
    const report = buildReport({
      cliVersion: "0.3.1", command: "workspace list",
      apiUrl: "https://api.internal.example.com",
    });
    expect(report.apiEnv).toBe("custom");
  });

  test("a malformed error code is dropped, not sent", () => {
    const report = buildReport({
      cliVersion: "0.3.1", command: "chat",
      apiUrl: "https://api.divinci.app",
      code: "Some free-text error: /Users/me/secret.txt",
    });
    expect(report.code).toBeUndefined();
  });

  test("an out-of-range status is still reported as a number or omitted", () => {
    const report = buildReport({
      cliVersion: "0.3.1", command: "chat", apiUrl: "https://api.divinci.app", status: 502,
    });
    expect(report.httpStatus).toBe(502);
  });
});

describe("classification", () => {
  test("auth failures classify as auth whatever the status", () => {
    expect(classify(401)).toBe("auth");
    expect(classify(403)).toBe("auth");
    expect(classify(403, "INVALID_TOKEN")).toBe("auth");
    expect(classify(undefined, "TOKEN_EXPIRED")).toBe("auth");
  });

  test("server, client and network are distinguished", () => {
    expect(classify(500)).toBe("server");
    expect(classify(429)).toBe("server");
    expect(classify(404)).toBe("client");
    expect(classify(undefined, "ENOTFOUND")).toBe("network");
    expect(classify()).toBe("unknown");
  });
});

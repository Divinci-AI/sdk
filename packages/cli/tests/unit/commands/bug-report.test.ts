/**
 * `divinci bug-report` gathers diagnostics locally. Two properties matter, and
 * both are the kind that rot silently.
 *
 * 1. It must never include a credential. The report exists to be pasted into an
 *    email or a support page, so a token in it is a token in someone's inbox.
 * 2. It must include the Auth0 tenant and audience. Those two fields are the
 *    entire diagnosis of the cli<=0.2.9 incident — prod tokens minted by the
 *    dev tenant — and nothing the user could see named them.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

const getProfileMock = vi.fn();
vi.mock("../../../src/config/credentials.js", () => ({
  getProfile: (name?: string) => getProfileMock(name),
}));

const { collectBugReport } = await import("../../../src/commands/bug-report/index.js");

const SECRET = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.c2lnbmF0dXJl";

describe("bug-report diagnostics", () => {
  // Braces are load-bearing. `beforeEach(() => mock.mockReset())` returns the
  // mock (mockReset is chainable), and Vitest treats a function returned from
  // beforeEach as a TEARDOWN callback — so it calls the mock after the test.
  // With a throwing implementation that surfaces as a failure inside the test,
  // pointing at code that is completely fine.
  beforeEach(() => { getProfileMock.mockReset(); });

  test("never includes the access token or api key", () => {
    getProfileMock.mockReturnValue({
      apiUrl: "https://api.divinci.app",
      authType: "oauth",
      accessToken: SECRET,
      refreshToken: "refresh-secret-value",
      apiKey: "divinci_live_supersecret",
    });
    const report = collectBugReport("0.3.1", "default");
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("refresh-secret-value");
    expect(serialized).not.toContain("divinci_live_supersecret");
    // It should still say a credential EXISTS — that is a diagnostic.
    expect(report.tokenPresent).toBe(true);
  });

  test("reports the Auth0 tenant and audience for the configured API", () => {
    getProfileMock.mockReturnValue({ apiUrl: "https://api.divinci.app", authType: "oauth" });
    const report = collectBugReport("0.3.1", "default");

    expect(report.auth0Domain).toBe("divinci-prod.us.auth0.com");
    expect(report.auth0Audience).toBe("chat.divinci.app:8080");
  });

  test("staging reports staging's tenant, not production's", () => {
    // The incident was one environment's config leaking into another. If this
    // field ever reports the wrong tenant, the report actively misleads.
    getProfileMock.mockReturnValue({ apiUrl: "https://api.stage.divinci.app", authType: "oauth" });
    const report = collectBugReport("0.3.1", "staging");

    expect(report.auth0Domain).toBe("divinci-staging.us.auth0.com");
  });

  test("detects an expired token", () => {
    const expired = `x.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.y`;
    getProfileMock.mockReturnValue({ apiUrl: "https://api.divinci.app", accessToken: expired });
    expect(collectBugReport("0.3.1", "default").tokenExpired).toBe(true);
  });

  test("survives a missing or unreadable credentials file", () => {
    // A diagnostics command that throws when the config is broken is useless
    // exactly when it is needed.
    getProfileMock.mockImplementation(() => { throw new Error("EACCES"); });
    const report = collectBugReport("0.3.1", "default");

    expect(report.tokenPresent).toBe(false);
    expect(report.apiUrl).toBe("https://api.divinci.app");
    expect(report.authType).toBe("none");
  });
});

import { describe, test, expect } from "vitest";
import { requireOAuthAuth, OAuthRequiredError } from "../../../src/utils/errors.js";

describe("requireOAuthAuth", () => {
  test("throws OAuthRequiredError when no accessToken is present", () => {
    expect(() => requireOAuthAuth({ apiKey: "divinci_api_xxx" }))
      .toThrow(OAuthRequiredError);
  });

  test("throws OAuthRequiredError when both apiKey and accessToken are missing", () => {
    expect(() => requireOAuthAuth({}))
      .toThrow(OAuthRequiredError);
  });

  test("does not throw when accessToken is present", () => {
    expect(() => requireOAuthAuth({ accessToken: "eyJhbGci..." }))
      .not.toThrow();
  });

  test("does not throw when both apiKey and accessToken are present", () => {
    expect(() => requireOAuthAuth({ apiKey: "divinci_api_xxx", accessToken: "eyJhbGci..." }))
      .not.toThrow();
  });

  test("error message mentions divinci auth login", () => {
    try {
      requireOAuthAuth({ apiKey: "divinci_api_xxx" });
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthRequiredError);
      expect((e as Error).message).toContain("divinci auth login");
    }
  });
});

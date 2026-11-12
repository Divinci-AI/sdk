import { describe, expect, it } from "vitest";
import {
  DOCS_SESSION_MESSAGE_TYPE,
  docsSessionUrl,
  isFirstPartyDocsParentOrigin,
  isTrustedChatOrigin,
  parseDocsSessionMessage,
} from "./session.js";

describe("isTrustedChatOrigin", () => {
  it("accepts the production and env-prefixed chat apps over https", () => {
    expect(isTrustedChatOrigin("https://chat.divinci.app")).toBe(true);
    expect(isTrustedChatOrigin("https://chat.stage.divinci.app")).toBe(true);
    expect(isTrustedChatOrigin("https://chat.dev.divinci.app")).toBe(true);
  });

  it("accepts local http", () => {
    expect(isTrustedChatOrigin("http://localhost:8080")).toBe(true);
    expect(isTrustedChatOrigin("http://127.0.0.1:8080")).toBe(true);
  });

  it("rejects other hosts and non-https public origins", () => {
    expect(isTrustedChatOrigin("https://evil.example")).toBe(false);
    expect(isTrustedChatOrigin("https://sdk.divinci.ai")).toBe(false);
    expect(isTrustedChatOrigin("http://chat.divinci.app")).toBe(false);
    expect(isTrustedChatOrigin("not a url")).toBe(false);
  });
});

describe("parseDocsSessionMessage", () => {
  it("accepts a signed-in payload with a token", () => {
    expect(
      parseDocsSessionMessage({
        type: DOCS_SESSION_MESSAGE_TYPE,
        authenticated: true,
        token: "eyJhbG",
      }),
    ).toEqual({
      type: DOCS_SESSION_MESSAGE_TYPE,
      authenticated: true,
      token: "eyJhbG",
    });
  });

  it("accepts an explicit unauthenticated payload", () => {
    expect(
      parseDocsSessionMessage({ type: DOCS_SESSION_MESSAGE_TYPE, authenticated: false }),
    ).toEqual({ type: DOCS_SESSION_MESSAGE_TYPE, authenticated: false });
  });

  it("rejects missing tokens and foreign message types", () => {
    expect(parseDocsSessionMessage({ type: DOCS_SESSION_MESSAGE_TYPE, authenticated: true })).toBeNull();
    expect(parseDocsSessionMessage({ type: "other", authenticated: true, token: "x" })).toBeNull();
    expect(parseDocsSessionMessage(null)).toBeNull();
  });
});

describe("isFirstPartyDocsParentOrigin", () => {
  it("accepts Divinci docs hosts and local Astro", () => {
    expect(isFirstPartyDocsParentOrigin("https://sdk.divinci.ai")).toBe(true);
    expect(isFirstPartyDocsParentOrigin("https://divinci-sdk-docs-staging.divinci-ai.workers.dev")).toBe(true);
    expect(isFirstPartyDocsParentOrigin("http://localhost:4321")).toBe(true);
  });

  it("rejects third-party embeds so they cannot probe chat.divinci.app", () => {
    expect(isFirstPartyDocsParentOrigin("https://customer.example")).toBe(false);
    expect(isFirstPartyDocsParentOrigin("https://chat.divinci.app")).toBe(false);
  });
});

describe("docsSessionUrl", () => {
  it("points at the first-party session path and stamps a first-party parent origin", () => {
    expect(docsSessionUrl("https://chat.divinci.app", "https://sdk.divinci.ai")).toBe(
      "https://chat.divinci.app/docs-assistant-session?origin=https%3A%2F%2Fsdk.divinci.ai",
    );
  });

  it("does not stamp a third-party parent origin into the query", () => {
    expect(docsSessionUrl("https://chat.divinci.app", "https://evil.example")).toBe(
      "https://chat.divinci.app/docs-assistant-session",
    );
  });
});

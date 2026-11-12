import { describe, it, expect } from "vitest";
import { embedSnippet } from "../../../src/commands/docs/snippet.js";

describe("embedSnippet", () => {
  it("npm flavor includes the install + mount with releaseId/apiUrl", () => {
    const s = embedSnippet({ releaseId: "rel_123", apiUrl: "https://api.stage.divinci.app", kind: "npm" });
    expect(s).toContain("npm install @divinci-ai/embed-chat-ui @divinci-ai/client");
    expect(s).toContain('import { mount } from "@divinci-ai/embed-chat-ui"');
    expect(s).toContain('releaseId: "rel_123"');
    expect(s).toContain('apiUrl: "https://api.stage.divinci.app"');
  });
  it("script flavor is a CDN module script", () => {
    const s = embedSnippet({ releaseId: "rel_123", kind: "script" });
    expect(s).toContain('<script type="module">');
    expect(s).toContain("https://esm.sh/@divinci-ai/embed-chat-ui");
    expect(s).toContain('releaseId: "rel_123"');
  });
  it("astro flavor mounts inside a component script", () => {
    const s = embedSnippet({ releaseId: "r", kind: "astro" });
    expect(s).toContain("DocsAssistant.astro");
    expect(s).toContain("mount(document.body");
  });
  it("defaults apiUrl to production and strips trailing slashes", () => {
    expect(embedSnippet({ releaseId: "r" })).toContain('apiUrl: "https://api.divinci.app"');
    expect(embedSnippet({ releaseId: "r", apiUrl: "https://api.divinci.app/" })).toContain('"https://api.divinci.app"');
  });
});

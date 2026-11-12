import { describe, it, expect } from "vitest";
import { toDocsTemplate, DOCS_TEMPLATE_SCHEMA } from "../../../src/commands/docs/template.js";

describe("toDocsTemplate", () => {
  const release = {
    _id: "rel_123", workspace: "ws_1", whitelabel: "wl_1",
    createdAt: "2026-01-01", updatedAt: "2026-02-02", ragVectorId: "vec_9",
    name: "Docs Assistant", description: "Answers from the docs",
    onTopic: { minimumContext: 1 }, threadPrefix: "You answer from these docs.",
    supportedLanguages: ["en"], mcpConfig: { enabled: true, exposedTools: ["search_knowledge"] },
    assistantId: "gemini-3-5-flash",
  };
  it("strips instance-specific keys and keeps config", () => {
    const t = toDocsTemplate(release, "rel_123");
    expect(t.schemaVersion).toBe(DOCS_TEMPLATE_SCHEMA);
    expect(t.exportedFrom).toBe("rel_123");
    // omitted
    for (const k of ["_id", "workspace", "whitelabel", "createdAt", "updatedAt", "ragVectorId"]) {
      expect(t.config).not.toHaveProperty(k);
    }
    // kept
    expect(t.config.name).toBe("Docs Assistant");
    expect(t.config.onTopic).toEqual({ minimumContext: 1 });
    expect(t.config.threadPrefix).toBe("You answer from these docs.");
    expect(t.config.mcpConfig).toEqual({ enabled: true, exposedTools: ["search_knowledge"] });
    expect(t.config.assistantId).toBe("gemini-3-5-flash");
  });
});

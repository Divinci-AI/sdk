import { describe, it, expect } from "vitest";

import { mergeMcpConfig } from "../../../src/commands/release/update";

/**
 * `mcpConfig` is the switch that decides whether the MCP Worker serves a
 * release at all, and it carries the wallet spend cap. Server-side
 * `castOptionalMcpConfig` REBUILDS the object from what it receives and the SDK
 * lets options overwrite current wholesale, so a partial write is a silent
 * erase. These tests pin the negative property — that setting one flag does not
 * drop the others — because that is the half nobody notices until a cap is gone.
 */
describe("mergeMcpConfig", () => {
  const existing = {
    enabled: true,
    exposedTools: ["search_knowledge"],
    allowedScopes: ["rag:read"],
    mcpRateLimit: { requestsPerMinute: 30, requestsPerDay: 5000 },
    allowAnonymousMcp: true,
    maxSpendPerTokenCents: 250,
  };

  it("KEEPS the spend cap when an unrelated flag is set", () => {
    const out = mergeMcpConfig(existing, { mcpRatePerMinute: "45" });
    expect(out.maxSpendPerTokenCents).toBe(250);
    expect(out.allowAnonymousMcp).toBe(true);
    expect(out.exposedTools).toEqual(["search_knowledge"]);
    expect(out.mcpRateLimit).toEqual({ requestsPerMinute: 45, requestsPerDay: 5000 });
  });

  it("keeps everything else when only toggling enabled", () => {
    const out = mergeMcpConfig(existing, { mcpEnabled: false });
    expect(out).toEqual({ ...existing, enabled: false });
  });

  it("refuses anonymous access with no cap, naming the fix", () => {
    expect(() => mergeMcpConfig({ enabled: true }, { mcpAllowAnonymous: true }))
      .toThrow(/--mcp-allow-anonymous requires a positive --mcp-max-spend-cents/);
  });

  /** Turning anonymity on is fine when a cap is ALREADY stored — the check runs
   *  against the merged value, not against the flags alone. */
  it("allows anonymous when the cap is already on the release", () => {
    const out = mergeMcpConfig({ enabled: true, maxSpendPerTokenCents: 100 }, { mcpAllowAnonymous: true });
    expect(out.allowAnonymousMcp).toBe(true);
    expect(out.maxSpendPerTokenCents).toBe(100);
  });

  it("refuses to zero a cap out from under live anonymous access", () => {
    expect(() => mergeMcpConfig(existing, { mcpMaxSpendCents: "0" }))
      .toThrow(/--mcp-max-spend-cents must be a positive integer/);
  });

  it("will not silently default enabled on a release that has no MCP config", () => {
    expect(() => mergeMcpConfig({}, { mcpRatePerDay: "100" }))
      .toThrow(/no MCP config yet — pass --mcp-enabled/);
  });

  it("parses comma lists and trims", () => {
    const out = mergeMcpConfig({ enabled: true }, { mcpExposedTools: " search_knowledge , chat_send ,, " });
    expect(out.exposedTools).toEqual(["search_knowledge", "chat_send"]);
  });

  it("rejects non-integer and negative numbers rather than coercing", () => {
    expect(() => mergeMcpConfig({ enabled: true }, { mcpRatePerMinute: "1.5" })).toThrow(/positive integer/);
    expect(() => mergeMcpConfig({ enabled: true }, { mcpRatePerDay: "-1" })).toThrow(/positive integer/);
    expect(() => mergeMcpConfig({ enabled: true }, { mcpMaxSpendCents: "abc" })).toThrow(/positive integer/);
  });

  it("does not mutate the release config it was handed", () => {
    const frozen = JSON.parse(JSON.stringify(existing));
    mergeMcpConfig(existing, { mcpEnabled: false, mcpExposedTools: "chat_send" });
    expect(existing).toEqual(frozen);
  });
});

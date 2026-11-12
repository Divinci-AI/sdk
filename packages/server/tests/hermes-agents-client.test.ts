import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HermesAgentsClient } from "../src/hermes-agents/index.js";
import type { ServerHttpClient } from "../src/http-client.js";

/**
 * Wiring tests for the Hermes agents client.
 *
 * `update` forwards its body verbatim today, so nothing here can fail — which
 * is exactly why it is worth pinning. Its sibling `releases` client had the
 * same shape until someone rewrote `updateInWorkspace` as an explicit
 * ALLOWLIST; after that, three separate fields (`skillConfig` and the three
 * voice fields) shipped INERT — the call returned 200 and the release did not
 * change. Three tests in this directory exist because of it.
 *
 * `proactive.partnerAgentKey` is the newest member of that risk class: it
 * carries no behaviour of its own, so a silent drop looks identical to an
 * agent that simply has no partner configured.
 */
function mockHttp() {
  return {
    get: vi.fn().mockResolvedValue({ runs: [] }),
    post: vi.fn().mockResolvedValue({ agentKey: "agent-x" }),
    put: vi.fn(),
    patch: vi.fn().mockResolvedValue({ agentKey: "agent-x" }),
    delete: vi.fn().mockResolvedValue({ ok: true }),
    upload: vi.fn(),
  } as unknown as ServerHttpClient;
}

const WS = "6a78623c61cf7fc659c40baf";
const AGENT = "6a78626d61cf7fc659c40d1c";
const PARTNER = "agent-99d9a71b7e203885499d2912";

describe("HermesAgentsClient", () => {
  let http: ReturnType<typeof mockHttp>;
  let client: HermesAgentsClient;

  beforeEach(() => {
    http = mockHttp();
    client = new HermesAgentsClient(http);
  });
  afterEach(() => vi.clearAllMocks());

  it("forwards a proactive pairing to the API untouched", async () => {
    await client.update(WS, AGENT, { proactive: { partnerAgentKey: PARTNER } });
    expect(http.patch).toHaveBeenCalledWith(
      `/white-label/${WS}/hermes-agent/${AGENT}`,
      { proactive: { partnerAgentKey: PARTNER } },
    );
  });

  it("forwards an explicit null so a pairing can be REMOVED", async () => {
    // The dangerous direction. If null were dropped anywhere between here and
    // Mongo, "unpair these agents" would return 200 and leave them paired —
    // and the caller has no way to tell, because an unpaired agent and a
    // silently-still-paired one look the same from the outside.
    await client.update(WS, AGENT, { proactive: { partnerAgentKey: null } });
    const [, body] = (http.patch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(body).toEqual({ proactive: { partnerAgentKey: null } });
    // `toEqual` alone would pass if the key were absent, since undefined and
    // missing compare equal — so assert the key is genuinely present.
    expect(Object.keys((body as { proactive: object }).proactive)).toContain("partnerAgentKey");
  });

  it("does not invent proactive config when the caller sent none", async () => {
    await client.update(WS, AGENT, { title: "Renamed" });
    expect(http.patch).toHaveBeenCalledWith(
      `/white-label/${WS}/hermes-agent/${AGENT}`,
      { title: "Renamed" },
    );
  });

  it("reads the run log, which IS the feature while an agent is in shadow", async () => {
    await client.proactiveRuns(WS, AGENT, 30);
    expect(http.get).toHaveBeenCalledWith(
      `/white-label/${WS}/hermes-agent/${AGENT}/proactive-runs?limit=30`,
    );
  });

  it("omits the limit rather than sending limit=0", async () => {
    // `?limit=0` would read as "no runs" to a server that trusts it, turning a
    // defaulted call into an empty log — the one result indistinguishable from
    // an agent that has never woken.
    await client.proactiveRuns(WS, AGENT);
    expect(http.get).toHaveBeenCalledWith(
      `/white-label/${WS}/hermes-agent/${AGENT}/proactive-runs`,
    );
  });
});

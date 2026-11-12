/**
 * PhoneUsageNamespace tests — paths encode the verified wire truth
 * (/white-label/:id/phone-usage/{voice,sms}).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PhoneUsageNamespace } from "../../src/namespaces/phone-usage/index.js";
import type { HttpClient } from "../../src/http-client.js";

function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpClient;
}

describe("PhoneUsageNamespace", () => {
  let mockHttpClient: HttpClient;
  let phoneUsage: PhoneUsageNamespace;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    phoneUsage = new PhoneUsageNamespace(mockHttpClient, { workspaceId: "ws-123" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("voice() GETs the voice-usage endpoint under the context workspaceId", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({
      whitelabelId: "ws-123",
      callsUnbilled: 2,
      totalNanoUSDUnbilled: "28000000",
      oldestCallStartedAt: 1700000000000,
    });

    const result = await phoneUsage.voice();

    expect(mockHttpClient.get).toHaveBeenCalledWith("/white-label/ws-123/phone-usage/voice");
    expect(result.callsUnbilled).toBe(2);
  });

  it("sms() GETs the sms-usage endpoint under the context workspaceId", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({
      whitelabelId: "ws-123",
      messagesUnbilled: 6,
      totalNanoUSDUnbilled: "47400000",
    });

    const result = await phoneUsage.sms();

    expect(mockHttpClient.get).toHaveBeenCalledWith("/white-label/ws-123/phone-usage/sms");
    expect(result.messagesUnbilled).toBe(6);
  });

  it("an explicit params.workspaceId overrides the namespace context", async () => {
    vi.mocked(mockHttpClient.get).mockResolvedValue({});

    await phoneUsage.voice({ workspaceId: "ws-override" });

    expect(mockHttpClient.get).toHaveBeenCalledWith("/white-label/ws-override/phone-usage/voice");
  });

  it("throws when no workspaceId is available (context or params)", async () => {
    const bare = new PhoneUsageNamespace(mockHttpClient, {});
    await expect(bare.voice()).rejects.toThrow(/workspaceId is required/);
  });
});

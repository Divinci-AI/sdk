/**
 * Phone Usage Client
 *
 * Server-side read of the workspace's current UNBILLED voice-call (LiveKit)
 * and SMS/MMS (Twilio) usage — what the next scheduled billing sweep will
 * charge, at cost (see server-resources/models/voice/usage-billing/
 * {rates,sms-rates}.ts for the rate cards).
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/phone-usage/*`) on 2026-07-19.
 */

import { ServerHttpClient } from "../http-client.js";

/** Response of `voice()`. */
export interface VoiceUsageResponse {
  whitelabelId: string;
  callsUnbilled: number;
  /** Unbilled cost, nanoUSD, as a string (holds bigint range). */
  totalNanoUSDUnbilled: string;
  /** Epoch ms of the oldest unbilled call, or null if there's none. */
  oldestCallStartedAt: number | null;
}

/** Response of `sms()`. */
export interface SmsUsageResponse {
  whitelabelId: string;
  messagesUnbilled: number;
  /** Unbilled cost, nanoUSD, as a string (holds bigint range). */
  totalNanoUSDUnbilled: string;
}

export class PhoneUsageClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/phone-usage`;
  }

  /** Unbilled LiveKit voice-call usage (calls, cost, oldest unbilled call). */
  async voice(workspaceId: string): Promise<VoiceUsageResponse> {
    return this.httpClient.get<VoiceUsageResponse>(`${this.base(workspaceId)}/voice`);
  }

  /** Unbilled Twilio SMS/MMS usage (messages, cost). */
  async sms(workspaceId: string): Promise<SmsUsageResponse> {
    return this.httpClient.get<SmsUsageResponse>(`${this.base(workspaceId)}/sms`);
  }
}

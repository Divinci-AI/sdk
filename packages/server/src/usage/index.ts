/**
 * Usage Client
 *
 * Server-side usage statistics and billing reports for workspace API keys
 * (BYOK provider keys): transaction counts, costs, success rates, and the
 * BYOK-vs-Divinci-wallet billing comparison.
 *
 * Wire paths verified against the public-api whitelabel router
 * (`/white-label/:whitelabelId/workspace-api-keys/*`) on 2026-06-10.
 */

import { ServerHttpClient } from "../http-client.js";

/** Usage statistics for one workspace + provider org. */
export interface UsageStatsResponse {
  success: boolean;
  whitelabelId: string;
  orgName: string;
  period: { startDate: number | null; endDate: number | null };
  stats: {
    totalTransactions: number;
    totalCost: number;
    totalUsage: number;
    successfulTransactions: number;
    failedTransactions: number;
    /** Percent 0–100 */
    successRate: number;
  };
}

/**
 * Usage Client
 *
 * @example
 * ```typescript
 * // Usage stats for the OpenAI BYOK key over the last 30 days
 * const { stats } = await divinci.usage.apiKeyUsage("ws-123", "openai", {
 *   startDate: Date.now() - 30 * 24 * 3600 * 1000,
 * });
 * console.log(stats.totalCost, stats.successRate);
 *
 * // Full billing report (BYOK vs Divinci wallet)
 * const report = await divinci.usage.billingReport("ws-123");
 * ```
 */
export class UsageClient {
  constructor(private readonly httpClient: ServerHttpClient) {}

  private base(workspaceId: string): string {
    return `/white-label/${workspaceId}/workspace-api-keys`;
  }

  /**
   * Usage statistics for a workspace API key org (transaction counts, costs,
   * success rates). Dates are epoch milliseconds.
   */
  async apiKeyUsage(
    workspaceId: string,
    orgName: string,
    options: { startDate?: number; endDate?: number } = {}
  ): Promise<UsageStatsResponse> {
    return this.httpClient.get<UsageStatsResponse>(
      `${this.base(workspaceId)}/${orgName}/usage`,
      { startDate: options.startDate, endDate: options.endDate }
    );
  }

  /**
   * Comprehensive billing report comparing BYOK vs Divinci wallet usage.
   */
  async billingReport(workspaceId: string): Promise<Record<string, unknown>> {
    return this.httpClient.get<Record<string, unknown>>(
      `${this.base(workspaceId)}/billing-report`
    );
  }
}

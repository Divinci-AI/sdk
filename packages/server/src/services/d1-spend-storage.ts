/**
 * D1 HTTP Spend Storage
 *
 * SpendStorage implementation backed by Cloudflare D1 via the HTTP API.
 * Enables the server SDK to persist cost tracking data to D1 from any
 * Node.js environment that can make HTTP requests (no D1 binding needed).
 *
 * Schema:
 * ```sql
 * CREATE TABLE IF NOT EXISTS spend_records (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   date TEXT NOT NULL,
 *   provider TEXT NOT NULL,
 *   userId TEXT NOT NULL,
 *   jobId TEXT,
 *   estimatedUsd REAL NOT NULL,
 *   actualUsd REAL,
 *   createdAt TEXT NOT NULL
 * );
 * ```
 *
 * @example
 * ```typescript
 * import { D1HttpSpendStorage } from "@divinci-ai/server";
 *
 * const storage = new D1HttpSpendStorage({
 *   apiToken: process.env.CLOUDFLARE_API_TOKEN!,
 *   accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
 *   databaseId: "your-d1-database-uuid",
 * });
 *
 * // Wire into SpendGuardClient
 * const spendGuard = new SpendGuardClient(httpClient, { storage });
 * ```
 */

import {
  type ProviderName,
  type SpendRecord,
  type DailySpendSummary,
  type SpendStorage,
  SPEND_LIMITS,
} from "./spend-guard.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface D1HttpStorageOptions {
  /** Cloudflare API token with D1 read + write permissions */
  apiToken: string;
  /** Cloudflare account ID */
  accountId: string;
  /** D1 database UUID */
  databaseId: string;
  /**
   * Base URL for the Cloudflare API. Defaults to
   * `https://api.cloudflare.com/client/v4`.
   */
  baseUrl?: string;
  /**
   * Whether to auto-create the spend_records table on construction.
   * Default: true. Set false if you manage schema migrations externally.
   */
  autoInitialize?: boolean;
}

interface D1QueryResult {
  results?: Record<string, unknown>[];
  success: boolean;
  meta?: {
    changed_db?: boolean;
    changes?: number;
    last_row_id?: number;
    rows_read?: number;
    rows_written?: number;
    duration?: number;
  };
}

interface D1ApiResponse {
  result?: D1QueryResult[];
  success: boolean;
  errors?: string[];
  messages?: string[];
}

// ---------------------------------------------------------------------------
// D1 HTTP Client
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS spend_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    provider TEXT NOT NULL,
    userId TEXT NOT NULL,
    jobId TEXT,
    estimatedUsd REAL NOT NULL,
    actualUsd REAL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spend_date ON spend_records(date);
  CREATE INDEX IF NOT EXISTS idx_spend_date_provider ON spend_records(date, provider);
  CREATE INDEX IF NOT EXISTS idx_spend_user ON spend_records(date, userId);
  CREATE INDEX IF NOT EXISTS idx_spend_job ON spend_records(jobId);
`;

// ---------------------------------------------------------------------------
// D1HttpSpendStorage
// ---------------------------------------------------------------------------

export class D1HttpSpendStorage implements SpendStorage {
  private readonly queryEndpoint: string;
  private initialized = false;

  constructor(private readonly options: D1HttpStorageOptions) {
    const base = (options.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
    this.queryEndpoint = `${base}/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`;
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Ensure the D1 schema exists. Called automatically unless
   * `autoInitialize: false` was passed.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    for (const stmt of SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean)) {
      await this.execute(stmt);
    }
    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // -----------------------------------------------------------------------
  // SpendStorage implementation
  // -----------------------------------------------------------------------

  async record(entry: Omit<SpendRecord, "id" | "createdAt">): Promise<SpendRecord> {
    await this.ensureInitialized();

    const createdAt = new Date().toISOString();
    const sql = `
      INSERT INTO spend_records (date, provider, userId, jobId, estimatedUsd, actualUsd, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params: unknown[] = [
      entry.date,
      entry.provider,
      entry.userId,
      entry.jobId ?? null,
      entry.estimatedUsd,
      entry.actualUsd ?? null,
      createdAt,
    ];

    const res = await this.execute(sql, params);
    const id = res?.meta?.last_row_id ?? 0;

    return {
      id,
      ...entry,
      createdAt,
    };
  }

  async sumByProvider(date: string, provider: ProviderName): Promise<number> {
    await this.ensureInitialized();
    const sql = "SELECT COALESCE(SUM(COALESCE(actualUsd, estimatedUsd)), 0) AS total FROM spend_records WHERE date = ? AND provider = ?";
    const rows = await this.query(sql, [date, provider]);
    return Number(rows[0]?.total ?? 0);
  }

  async sumTotal(date: string): Promise<number> {
    await this.ensureInitialized();
    const sql = "SELECT COALESCE(SUM(COALESCE(actualUsd, estimatedUsd)), 0) AS total FROM spend_records WHERE date = ?";
    const rows = await this.query(sql, [date]);
    return Number(rows[0]?.total ?? 0);
  }

  async countByUser(date: string, userId: string): Promise<number> {
    await this.ensureInitialized();
    const sql = "SELECT COUNT(*) AS count FROM spend_records WHERE date = ? AND userId = ?";
    const rows = await this.query(sql, [date, userId]);
    return Number(rows[0]?.count ?? 0);
  }

  async countActiveByUser(userId: string): Promise<number> {
    await this.ensureInitialized();
    const sql = "SELECT COUNT(*) AS count FROM spend_records WHERE userId = ? AND actualUsd IS NULL";
    const rows = await this.query(sql, [userId]);
    return Number(rows[0]?.count ?? 0);
  }

  async updateActualCost(jobId: string, actualUsd: number): Promise<void> {
    await this.ensureInitialized();
    const sql = "UPDATE spend_records SET actualUsd = ? WHERE jobId = ?";
    await this.execute(sql, [actualUsd, jobId]);
  }

  async getDailySummary(date: string): Promise<DailySpendSummary> {
    await this.ensureInitialized();

    // All records for the day
    const rows = await this.query<{
      provider: string;
      userId: string;
      estimatedUsd: number;
      actualUsd: number | null;
      jobId: string | null;
    }>(
      "SELECT provider, userId, estimatedUsd, actualUsd, jobId FROM spend_records WHERE date = ?",
      [date]
    );

    const totalUsd = rows.reduce((sum, r) => sum + (r.actualUsd ?? r.estimatedUsd), 0);

    const byProvider = {} as DailySpendSummary["byProvider"];
    const byUser = {} as DailySpendSummary["byUser"];

    for (const row of rows) {
      const p = row.provider as ProviderName;
      if (!byProvider[p]) {
        byProvider[p] = { count: 0, estimatedUsd: 0, actualUsd: 0 };
      }
      byProvider[p].count++;
      byProvider[p].estimatedUsd += row.estimatedUsd;
      if (row.actualUsd !== null) {
        byProvider[p].actualUsd! += row.actualUsd;
      }

      const u = row.userId;
      if (!byUser[u]) {
        byUser[u] = { count: 0, totalUsd: 0 };
      }
      byUser[u].count++;
      byUser[u].totalUsd += row.actualUsd ?? row.estimatedUsd;
    }

    return {
      date,
      totalUsd,
      budgetLimitUsd: SPEND_LIMITS.DAILY_GLOBAL_USD,
      paused: totalUsd >= SPEND_LIMITS.DAILY_GLOBAL_USD,
      byProvider,
      byUser,
    };
  }

  // -----------------------------------------------------------------------
  // D1 HTTP API helpers
  // -----------------------------------------------------------------------

  /**
   * Execute a SQL query and return the result rows.
   */
  private async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const body: Record<string, unknown> = { sql };
    if (params.length > 0) {
      body.params = params;
    }

    const res = await this.rawQuery(body);
    // D1 returns result as array of batches; first batch has the actual rows
    const batch = res.result?.[0];
    return (batch?.results ?? []) as T[];
  }

  /**
   * Execute a SQL statement (INSERT, UPDATE, CREATE, etc.) that doesn't
   * return rows.
   */
  private async execute(
    sql: string,
    params: unknown[] = []
  ): Promise<D1QueryResult> {
    const body: Record<string, unknown> = { sql };
    if (params.length > 0) {
      body.params = params;
    }

    const res = await this.rawQuery(body);
    return res.result?.[0] ?? { success: false };
  }

  /**
   * Send a raw POST to the D1 query endpoint.
   */
  private async rawQuery(body: Record<string, unknown>): Promise<D1ApiResponse> {
    const res = await fetch(this.queryEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.options.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `D1 HTTP API error: ${res.status} ${text.substring(0, 500)}`
      );
    }

    const text = await res.text();
    let data: D1ApiResponse;
    try {
      data = JSON.parse(text) as D1ApiResponse;
    } catch {
      throw new Error(`D1 HTTP API parse error: ${text.substring(0, 200)}`);
    }

    if (!data.success) {
      const errors = (data.errors ?? []).join("; ");
      throw new Error(`D1 HTTP API error: ${errors || "unknown"}`);
    }

    return data;
  }
}

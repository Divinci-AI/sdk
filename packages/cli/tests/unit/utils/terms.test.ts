import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock colors to avoid ANSI codes and make assertions cleaner
vi.mock("../../../src/output/colors.js", () => ({
  colors: {
    red: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
    cyanBold: (s: string) => s,
  },
}));

// Mock @divinci-ai/server — define class inside factory so vi.mock hoisting works
vi.mock("@divinci-ai/server", () => {
  class ServerApiError extends Error {
    readonly code: string;
    readonly status?: number;
    readonly details?: Record<string, unknown>;

    constructor(
      message: string,
      options: { code?: string; status?: number; details?: Record<string, unknown> } = {}
    ) {
      super(message);
      this.name = "ServerApiError";
      this.code = options.code ?? "UNKNOWN_ERROR";
      this.status = options.status;
      this.details = options.details;
    }
  }
  return { ServerApiError, ServerHttpClient: class {} };
});

// Never prompt in tests
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

import { ServerApiError } from "@divinci-ai/server";
import {
  getTermsGateFromError,
  promptAndAcceptTerms,
  acceptTerms,
} from "../../../src/utils/terms.js";

const DETAILS = {
  tosId: "tos1",
  version: 3,
  title: "Terms",
  content: "## md",
  releaseId: "release1",
};

describe("getTermsGateFromError", () => {
  it("extracts the gate from a TERMS_NOT_ACCEPTED ServerApiError", () => {
    const err = new ServerApiError("blocked", {
      code: "TERMS_NOT_ACCEPTED",
      status: 403,
      details: DETAILS,
    });
    expect(getTermsGateFromError(err)).toEqual(DETAILS);
  });

  it("returns null for other ServerApiErrors", () => {
    const err = new ServerApiError("nope", { code: "FORBIDDEN", status: 403 });
    expect(getTermsGateFromError(err)).toBeNull();
  });

  it("returns null for non-ServerApiError values", () => {
    expect(getTermsGateFromError(new Error("boom"))).toBeNull();
    expect(getTermsGateFromError(undefined)).toBeNull();
    expect(getTermsGateFromError("string")).toBeNull();
  });

  it("returns null when details are malformed (missing tosId/version)", () => {
    const err = new ServerApiError("blocked", {
      code: "TERMS_NOT_ACCEPTED",
      status: 403,
      details: { title: "Terms" },
    });
    expect(getTermsGateFromError(err)).toBeNull();
  });
});

describe("promptAndAcceptTerms", () => {
  const httpClient = { post: vi.fn() };

  let ttyOut: boolean | undefined;
  let ttyIn: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    ttyOut = process.stdout.isTTY;
    ttyIn = process.stdin.isTTY;
  });

  afterEach(() => {
    Object.assign(process.stdout, { isTTY: ttyOut });
    Object.assign(process.stdin, { isTTY: ttyIn });
  });

  it("returns false without prompting when not a TTY (scripts/CI)", async () => {
    Object.assign(process.stdout, { isTTY: false });
    Object.assign(process.stdin, { isTTY: false });

    const { confirm } = await import("@inquirer/prompts");
    const accepted = await promptAndAcceptTerms(httpClient as never, DETAILS);

    expect(accepted).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(httpClient.post).not.toHaveBeenCalled();
  });
});

describe("acceptTerms", () => {
  const httpClient = { post: vi.fn().mockResolvedValue({}) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to the public release-scoped accept endpoint", async () => {
    await acceptTerms(httpClient as never, DETAILS);

    expect(httpClient.post).toHaveBeenCalledWith(
      "/white-label-release/release1/terms-of-service/accept",
      { tosId: "tos1", version: 3 },
    );
  });

  it("throws a web-app hint when the gate lacks a releaseId", async () => {
    await expect(
      acceptTerms(httpClient as never, { tosId: "tos1", version: 3 }),
    ).rejects.toThrowError(/web app/);
    expect(httpClient.post).not.toHaveBeenCalled();
  });
});

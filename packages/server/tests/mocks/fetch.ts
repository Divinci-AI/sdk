/**
 * Fetch mock utilities for server package testing
 */

import { vi } from "vitest";

export interface MockResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  ok?: boolean;
}

/**
 * Create a mock Response object
 */
export function createMockResponse(options: MockResponse = {}): Response {
  const {
    status = 200,
    statusText = "OK",
    headers = {},
    body = {},
    ok = status >= 200 && status < 300,
  } = options;

  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", "application/json");
  }

  return {
    ok,
    status,
    statusText,
    headers: responseHeaders,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    blob: vi.fn().mockResolvedValue(new Blob([JSON.stringify(body)])),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    formData: vi.fn().mockResolvedValue(new FormData()),
    clone: vi.fn().mockReturnThis(),
    body: null,
    bodyUsed: false,
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
  } as unknown as Response;
}

/**
 * Create a mock fetch function
 */
export function createMockFetch(responses: MockResponse[] | MockResponse = {}) {
  const responseArray = Array.isArray(responses) ? responses : [responses];
  let callIndex = 0;

  return vi.fn().mockImplementation(() => {
    const response = responseArray[Math.min(callIndex, responseArray.length - 1)];
    callIndex++;
    return Promise.resolve(createMockResponse(response));
  });
}

/**
 * Create a mock fetch that fails with network error
 */
export function createNetworkErrorFetch() {
  return vi.fn().mockRejectedValue(new TypeError("fetch failed"));
}

/**
 * ExternalToolsNamespace tests — the paths encode verified wire truth against
 * `public-api/src/api/v1/routes/external-tools.ts`.
 *
 * The value here is the WIRE SHAPE, not the HTTP client: a namespace that
 * silently posts to the wrong path or drops the force flag fails only against a
 * live server, long after it was written.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ExternalToolsNamespace,
  type CreateExternalToolInput,
} from "../../src/namespaces/external-tools/index.js";
import type { HttpClient } from "../../src/http-client.js";

function createMockHttpClient(): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getBaseUrl: vi.fn().mockReturnValue("https://api.example.com"),
    getToken: vi.fn().mockResolvedValue(null),
  } as unknown as HttpClient;
}

describe("ExternalToolsNamespace", () => {
  let http: HttpClient;
  let ns: ExternalToolsNamespace;

  beforeEach(() => {
    http = createMockHttpClient();
    // No workspaceId in the path: /api/v1 is scoped by the API key, so a
    // namespace that interpolated one would 404.
    ns = new ExternalToolsNamespace(http, {});
  });

  afterEach(() => vi.clearAllMocks());

  it("list() GETs /api/v1/external-tools", async () => {
    vi.mocked(http.get).mockResolvedValue([]);
    await ns.list();
    expect(http.get).toHaveBeenCalledWith("/api/v1/external-tools");
  });

  it("get() encodes the id", async () => {
    vi.mocked(http.get).mockResolvedValue({});
    await ns.get("abc/def");
    expect(http.get).toHaveBeenCalledWith("/api/v1/external-tools/abc%2Fdef");
  });

  it("create() POSTs the input unchanged", async () => {
    const input: CreateExternalToolInput = {
      toolType: "RAG/Chunker",
      slug: "acme-parser",
      title: "Acme Parser",
      endpointUrl: "https://parse.acme.com/v1/chunks",
      authType: "bearer",
      authSecret: "s3cret",
    };
    vi.mocked(http.post).mockResolvedValue({});
    await ns.create(input);
    expect(http.post).toHaveBeenCalledWith("/api/v1/external-tools", input);
  });

  it("create() accepts a RAG/Retriever — the type is a union, not a parser-only literal", async () => {
    const input: CreateExternalToolInput = {
      toolType: "RAG/Retriever",
      slug: "acme-search",
      title: "Acme Search",
      endpointUrl: "https://search.acme.com/query",
      timeoutMs: 2000,
    };
    vi.mocked(http.post).mockResolvedValue({});
    await ns.create(input);
    expect(http.post).toHaveBeenCalledWith("/api/v1/external-tools", input);
  });

  it("update() PATCHes and does not put the id in the body", async () => {
    vi.mocked(http.patch).mockResolvedValue({});
    await ns.update("id1", { title: "Renamed" });
    expect(http.patch).toHaveBeenCalledWith("/api/v1/external-tools/id1", { title: "Renamed" });
  });

  it("delete() omits the force flag by default", async () => {
    vi.mocked(http.delete).mockResolvedValue({ deleted: true, filesStillReferencing: 0, vectorsStillReferencing: 0 });
    await ns.delete("id1");
    expect(http.delete).toHaveBeenCalledWith("/api/v1/external-tools/id1");
  });

  it("delete({force:true}) sends ?force=true — the server refuses without it while files reference the tool", async () => {
    vi.mocked(http.delete).mockResolvedValue({ deleted: true, filesStillReferencing: 3, vectorsStillReferencing: 0 });
    await ns.delete("id1", { force: true });
    expect(http.delete).toHaveBeenCalledWith("/api/v1/external-tools/id1?force=true");
  });

  it("returns the server's payload verbatim", async () => {
    const tool = { id: "1", toolId: "ext:ws:acme-parser", hasAuth: true };
    vi.mocked(http.get).mockResolvedValue(tool);
    await expect(ns.get("1")).resolves.toBe(tool);
  });
});

/**
 * RagClient: the embedding catalogue and the BYOK reference on create/update.
 * The client used to take no embedding model at all on create (it sent only a title and a
 * hard-coded backend), so a caller could not choose Voyage — or any model — through the SDK.
 */
import { describe, it, expect, vi } from "vitest";
import { RagClient } from "../src/rag/index.js";
import type { EmbeddingModelInfo } from "@divinci-ai/types";

const M = (id: string, provider: string, keySource: EmbeddingModelInfo["keySource"], dbs = ["qdrant"]): EmbeddingModelInfo =>
  ({ id, provider, displayName: id, dimensions: 1024, compatibleVectorDbs: dbs, keySource });

function client(get = vi.fn().mockResolvedValue({})) {
  const http = { get, post: vi.fn().mockResolvedValue({ collection: { id: "c1", title: "t" } }), patch: vi.fn().mockResolvedValue({ success: true }), delete: vi.fn() };
  return { rag: new RagClient(http as never), http };
}

describe("RagClient.listEmbeddingModels", () => {
  const models = [M("@cf/baai/bge-m3", "cloudflare", "divinci", ["qdrant", "vectorize"]), M("voyage-4", "voyage", "either", ["qdrant", "vectorize"]), M("voyage-4-lite", "voyage", "byok")];

  it("reads the v1 catalogue", async () => {
    const { rag, http } = client(vi.fn().mockResolvedValue({ models }));
    expect(await rag.listEmbeddingModels()).toHaveLength(3);
    expect(http.get).toHaveBeenCalledWith("/api/v1/rag/embedding-models");
  });

  it("filters by provider, vector database and key source ('byok' also matches 'either')", async () => {
    const { rag } = client(vi.fn().mockResolvedValue({ models }));
    expect((await rag.listEmbeddingModels({ provider: "voyage" })).map((m) => m.id)).toEqual(["voyage-4", "voyage-4-lite"]);
    expect((await rag.listEmbeddingModels({ vectorDb: "vectorize" })).map((m) => m.id)).toEqual(["@cf/baai/bge-m3", "voyage-4"]);
    expect((await rag.listEmbeddingModels({ keySource: "byok" })).map((m) => m.id)).toEqual(["voyage-4", "voyage-4-lite"]);
    expect((await rag.listEmbeddingModels({ keySource: "divinci" })).map((m) => m.id)).toEqual(["@cf/baai/bge-m3"]);
  });

  it("tolerates an empty response", async () => {
    const { rag } = client(vi.fn().mockResolvedValue({}));
    expect(await rag.listEmbeddingModels()).toEqual([]);
  });
});

describe("RagClient embedding fields", () => {
  it("createCollection sends the model and the key reference when given", async () => {
    const { rag, http } = client();
    await rag.createCollection({ name: "t", workspaceId: "w", embeddingModel: "voyage-4", embeddingAuthId: "a".repeat(24) });
    expect(http.post.mock.calls[0][1]).toMatchObject({ title: "t", embeddingModel: "voyage-4", embeddingAuthId: "a".repeat(24) });
  });

  it("createCollection sends neither when omitted, so the server default applies", async () => {
    const { rag, http } = client();
    await rag.createCollection({ name: "t", workspaceId: "w" });
    expect("embeddingModel" in http.post.mock.calls[0][1]).toBe(false);
    expect("embeddingAuthId" in http.post.mock.calls[0][1]).toBe(false);
  });

  it("updateCollectionSettings can set a key and null clears it", async () => {
    const { rag, http } = client();
    await rag.updateCollectionSettings("w", "c1", { embeddingAuthId: "b".repeat(24) });
    await rag.updateCollectionSettings("w", "c1", { embeddingAuthId: null });
    expect(http.patch.mock.calls[0][1]).toEqual({ embeddingAuthId: "b".repeat(24) });
    expect(http.patch.mock.calls[1][1]).toEqual({ embeddingAuthId: null });
  });
});

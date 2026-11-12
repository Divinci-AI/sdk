import { describe, it, expect } from "vitest";
import {
  inferVectorDbType,
  parseCommaSeparatedIds,
  flattenMultiTargetMap,
} from "../../../../src/commands/workspace/clone-utils.js";

describe("inferVectorDbType", () => {
  it("maps cloudflare-v2 to vectorize", () => {
    expect(inferVectorDbType("cloudflare-v2")).toBe("vectorize");
  });

  it("maps qdrant-cosine to qdrant", () => {
    expect(inferVectorDbType("qdrant-cosine")).toBe("qdrant");
  });

  it("defaults unknown tools to vectorize", () => {
    expect(inferVectorDbType(undefined)).toBe("vectorize");
  });
});

describe("parseCommaSeparatedIds", () => {
  it("parses valid ObjectIds", () => {
    const id = "6a1950ded50388e017a24dd7";
    expect(parseCommaSeparatedIds(`${id},6a19fe284813cdc0a234ed0d`)).toEqual([
      id,
      "6a19fe284813cdc0a234ed0d",
    ]);
  });

  it("rejects invalid ids", () => {
    expect(() => parseCommaSeparatedIds("not-an-id")).toThrow(/Invalid ObjectId/);
  });
});

describe("flattenMultiTargetMap", () => {
  it("takes the first cloned id per source", () => {
    expect(
      flattenMultiTargetMap({
        abc: ["new1", "new2"],
        def: ["only"],
      }),
    ).toEqual({ abc: "new1", def: "only" });
  });
});

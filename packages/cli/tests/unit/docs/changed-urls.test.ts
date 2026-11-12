import { describe, it, expect } from "vitest";
import {
  mapDocsChangesToUrls,
  DOCS_SYNC_INGEST_DISABLED_HINT,
} from "../../../src/commands/docs/changed-urls.js";

describe("mapDocsChangesToUrls", () => {
  it("maps Starlight content paths to page URLs under a base origin", () => {
    expect(
      mapDocsChangesToUrls(
        [
          "src/content/docs/index.md",
          "src/content/docs/server/rag.mdx",
          "workspace/sdk/docs/src/content/docs/guides/models.md",
        ],
        "https://sdk.divinci.ai/",
      ),
    ).toEqual([
      "https://sdk.divinci.ai/",
      "https://sdk.divinci.ai/server/rag/",
      "https://sdk.divinci.ai/guides/models/",
    ]);
  });

  it("returns path-only when base URL is empty (report without origin)", () => {
    expect(mapDocsChangesToUrls(["src/content/docs/cli/overview.md"], "")).toEqual([
      "/cli/overview/",
    ]);
  });
});

describe("DOCS_SYNC_INGEST_DISABLED_HINT", () => {
  it("points operators at the connector swap path, not rag crawl", () => {
    expect(DOCS_SYNC_INGEST_DISABLED_HINT).toMatch(/report-only/i);
    expect(DOCS_SYNC_INGEST_DISABLED_HINT).toMatch(/connectors web-crawl/);
    expect(DOCS_SYNC_INGEST_DISABLED_HINT).toMatch(/--swap/);
    expect(DOCS_SYNC_INGEST_DISABLED_HINT).toMatch(/isVectorUsed/);
  });
});

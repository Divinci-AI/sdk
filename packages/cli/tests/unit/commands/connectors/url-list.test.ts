import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { parseUrlList, MAX_URL_LIST } from "../../../../src/commands/connectors/url-list.js";
import { registerConnectorsCommands } from "../../../../src/commands/connectors/index.js";

/**
 * `connectors web-crawl --urls-file` sends a local URL list inline (feedUrls),
 * so a customer with a list of pages does not have to host it first. Guard for
 * KNOWN-GAPS concurrent-crawls-of-one-host-failed-every-page (the race's
 * Divinci side had a local urls.txt and no way to feed it as one sync).
 */
describe("parseUrlList", () => {
  it("reads one URL per line, skipping blanks and comments, keeping order, dropping duplicates", () => {
    const text = "# pages\nhttps://a.example/x\n\n  https://a.example/y  \nhttps://a.example/x\r\nhttp://b.example/\n";
    expect(parseUrlList(text)).toEqual(["https://a.example/x", "https://a.example/y", "http://b.example/"]);
  });

  it("accepts a JSON array", () => {
    expect(parseUrlList('["https://a.example/1", "https://a.example/2"]')).toEqual([
      "https://a.example/1",
      "https://a.example/2",
    ]);
  });

  it("names the line of anything that is not an http(s) URL instead of skipping it", () => {
    expect(() => parseUrlList("https://a.example/1\nftp://a.example/2\n")).toThrow(/line 2/);
    expect(() => parseUrlList("https://a.example/1\nnot a url\n")).toThrow(/line 2/);
  });

  it("refuses an empty list and one over the server's limit", () => {
    expect(() => parseUrlList("# nothing\n\n")).toThrow(/empty/);
    const many = Array.from({ length: MAX_URL_LIST + 1 }, (_, i) => `https://a.example/${i}`).join("\n");
    expect(() => parseUrlList(many)).toThrow(/at most 5000/);
  });
});

describe("connectors web-crawl --urls-file", () => {
  it("is registered", () => {
    const connectors = new Command("connectors");
    registerConnectorsCommands(connectors);
    const crawl = connectors.commands.find((c) => c.name() === "web-crawl");
    expect(crawl?.options.map((o) => o.long)).toContain("--urls-file");
  });
});

describe("connectors web-crawl --limit warning", () => {
  it("warns only when --limit was passed, not on its default", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../../../src/commands/connectors/index.ts", import.meta.url), "utf8")
    );
    expect(src).toMatch(/isFeed && cmd\.getOptionValueSource\("limit"\) === "cli"/);
  });
});

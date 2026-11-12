import { describe, it, expect, vi } from "vitest";
import { orderByRecency, recencyDirective, type SourcePassage } from "../../../src/commands/rag/synthesize/recency.js";
import { buildChapterSynthesisPrompt } from "../../../src/commands/rag/synthesize/chapter.js";
import { buildOutlinePrompt, parseOutline, dedupeOutlineChapters } from "../../../src/commands/rag/synthesize/outline.js";
import { assembleMasterBook } from "../../../src/commands/rag/synthesize/assemble.js";
import { synthesizeMasterBook } from "../../../src/commands/rag/synthesize/run.js";
import { expandChapterQueries, mergePassages } from "../../../src/commands/rag/synthesize/queries.js";

const P = (content: string, source?: string, year?: number, score?: number): SourcePassage => ({ content, source, year, score });

describe("recency", () => {
  it("orders newest-first, dated before undated, stable within ties", () => {
    const out = orderByRecency([
      P("a", "Old Book", 2005),
      P("b", "No Year"),
      P("c", "New Book", 2021),
      P("d", "Mid Book", 2013),
    ]);
    expect(out.map((p) => p.content)).toEqual(["c", "d", "a", "b"]);
  });

  it("recencyDirective lists sources oldest→newest and names the newest to prefer", () => {
    const d = recencyDirective([P("x", "Eat to Live", 2011), P("y", "Eat for Life", 2020)]);
    expect(d).toContain("Eat to Live (2011)");
    expect(d).toContain("Eat for Life (2020)");
    expect(d).toMatch(/MOST RECENT source \(Eat for Life, 2020\)/);
    // oldest appears before newest in the listing
    expect(d.indexOf("2011")).toBeLessThan(d.indexOf("2020"));
  });

  it("recencyDirective is empty when no passage carries a year", () => {
    expect(recencyDirective([P("x", "Unknown"), P("y")])).toBe("");
  });
});

describe("buildChapterSynthesisPrompt", () => {
  it("embeds dedup + recency + voice instructions and presents passages newest-first", () => {
    const r = buildChapterSynthesisPrompt({
      chapterTitle: "Protein",
      passages: [P("old protein advice", "Book A", 2008, 0.9), P("new protein advice", "Book B", 2022, 0.8)],
      voiceName: "Dr. Joel Fuhrman",
    });
    expect(r.system).toMatch(/DEDUPLICATE/);
    expect(r.system).toMatch(/PREFER THE LATEST/);
    expect(r.system).toContain("Dr. Joel Fuhrman");
    expect(r.user).toContain("# Chapter to write: Protein");
    expect(r.user).toContain("SOURCE RECENCY");
    // newest passage (2022) is presented before the 2008 one
    expect(r.user.indexOf("new protein advice")).toBeLessThan(r.user.indexOf("old protein advice"));
    expect(r.usedPassages[0].year).toBe(2022);
  });

  it("trims by relevance under the char budget, keeping highest-score passages", () => {
    const big = "x".repeat(100);
    const r = buildChapterSynthesisPrompt({
      chapterTitle: "C",
      passages: [P(big, "low", 2000, 0.1), P(big, "high", 2000, 0.9), P(big, "mid", 2000, 0.5)],
      maxPassageChars: 150, // only ~1 passage fits
    });
    expect(r.droppedForBudget).toBe(2);
    expect(r.usedPassages).toHaveLength(1);
    expect(r.usedPassages[0].source).toBe("high"); // highest score survived
  });
});

describe("outline", () => {
  it("buildOutlinePrompt includes each book + the no-repeat instruction", () => {
    const p = buildOutlinePrompt([
      { title: "Eat to Live", year: 2011, outlineOrSummary: "ch1; ch2" },
      { title: "Eat for Life", year: 2020, outlineOrSummary: "chA; chB" },
    ], { voiceName: "Dr. Fuhrman" });
    expect(p).toContain("Eat to Live");
    expect(p).toContain("Eat for Life (2020)");
    expect(p).toMatch(/EXACTLY ONCE/);
  });

  it("parseOutline tolerates 1./1) numbering and —/–/- scope separators", () => {
    const text = [
      "Here is your outline:",
      "1. Why Diets Fail — the science of hunger",
      "2) Nutrient Density – eat more, weigh less",
      "3. Supplements - what to actually take",
      "   ",
      "Hope this helps!",
    ].join("\n");
    const out = parseOutline(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ number: 1, title: "Why Diets Fail", summary: "the science of hunger" });
    expect(out[1].title).toBe("Nutrient Density");
    expect(out[2].summary).toBe("what to actually take");
  });

  it("dedupeOutlineChapters merges near-identical titles and renumbers", () => {
    const deduped = dedupeOutlineChapters([
      { number: 1, title: "Introduction to Nutritarian Eating" },
      { number: 2, title: "introduction to  nutritarian eating!" },
      { number: 3, title: "The G-BOMBS" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((c) => c.number)).toEqual([1, 2]);
    expect(deduped[1].title).toBe("The G-BOMBS");
  });
});

describe("assembleMasterBook", () => {
  it("produces a title, a linked TOC, and the chapters in order", () => {
    const md = assembleMasterBook({
      title: "The Complete Fuhrman",
      author: "Dr. Joel Fuhrman",
      chapters: [
        { number: 1, title: "Why Diets Fail", body: "Body one." },
        { number: 2, title: "Nutrient Density", body: "Body two." },
      ],
    });
    expect(md).toContain("# The Complete Fuhrman");
    expect(md).toContain("## Contents");
    expect(md).toContain("1. [Why Diets Fail](#why-diets-fail)");
    expect(md).toContain("## 2. Nutrient Density");
    expect(md.indexOf("Body one.")).toBeLessThan(md.indexOf("Body two."));
  });
});

describe("query expansion + merge (recall)", () => {
  it("expandChapterQueries splits a summary into sub-topics + keeps the title", () => {
    const qs = expandChapterQueries({ title: "The Nutritarian Foundation", summary: "nutrient density and why it reverses disease" });
    expect(qs).toContain("nutrient density and why it reverses disease"); // full summary
    expect(qs).toContain("nutrient density");                            // sub-topic before "and"
    expect(qs).toContain("why it reverses disease");                     // sub-topic after "and"
    expect(qs).toContain("The Nutritarian Foundation");                  // title
  });

  it("expandChapterQueries dedupes, drops tiny fragments, and caps the count", () => {
    const qs = expandChapterQueries({ title: "A", summary: "x, x, beans and greens" }, 3);
    expect(qs.length).toBeLessThanOrEqual(3);
    expect(qs.filter((q) => q === "x")).toHaveLength(0); // "x" is < 3 chars → dropped
    // case-insensitive dedupe — no duplicate queries
    expect(new Set(qs.map((q) => q.toLowerCase())).size).toBe(qs.length);
  });

  it("expandChapterQueries falls back to just the title when there is no summary", () => {
    expect(expandChapterQueries({ title: "Greens and Beans" })).toEqual(["Greens and Beans"]);
  });

  it("mergePassages dedupes across sub-queries keeping the highest score, ranked desc, capped", () => {
    const merged = mergePassages(
      [
        [P("alpha content here", "A", 2020, 0.7), P("beta content here", "B", 2019, 0.6)],
        [P("alpha content here", "A", 2020, 0.95), P("gamma content here", "C", 2021, 0.5)], // alpha dup w/ higher score
      ],
      2,
    );
    expect(merged).toHaveLength(2); // capped
    expect(merged[0].content).toBe("alpha content here");
    expect(merged[0].score).toBe(0.95); // kept the higher score of the duplicate
    expect(merged[1].content).toBe("beta content here"); // 0.6 > 0.5 gamma, which the cap drops
  });
});

describe("synthesizeMasterBook (orchestrator)", () => {
  it("retrieves + generates per chapter, threads voice/k, returns chapters in order", async () => {
    const retrieve = vi.fn(async (_q: string, _k: number) => [P("passage", "Book", 2020, 0.9)]);
    const generate = vi.fn(async ({ user }: { system: string, user: string }) =>
      user.includes("Why Diets Fail") ? "CHAPTER ONE PROSE" : "CHAPTER TWO PROSE");

    const chapters = await synthesizeMasterBook(
      [
        { number: 1, title: "Why Diets Fail", summary: "hunger and cravings" },
        { number: 2, title: "Nutrient Density" },
      ],
      { retrieve, generate },
      { passagesPerChapter: 10, voiceName: "Dr. Fuhrman" },
    );

    // Ch1 fans out to sub-queries (summary, its "and"-split sub-topics, title);
    // ch2 has no summary → just the title. Each is retrieved.
    const queriedCh1 = retrieve.mock.calls.map((c) => c[0]);
    expect(queriedCh1).toEqual(expect.arrayContaining(["hunger and cravings", "hunger", "cravings", "Why Diets Fail", "Nutrient Density"]));
    expect(retrieve.mock.calls.every((c) => c[1] === 10)).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
    // voice flowed into the synthesis prompt
    expect(generate.mock.calls[0][0].system).toContain("Dr. Fuhrman");
    expect(chapters.map((c) => c.title)).toEqual(["Why Diets Fail", "Nutrient Density"]);
    expect(chapters[0].body).toBe("CHAPTER ONE PROSE");
    expect(chapters.map((c) => c.number)).toEqual([1, 2]);
  });

  it("keeps going when one chapter's generate fails (no whole-run abort)", async () => {
    const retrieve = vi.fn(async () => [P("p", "B", 2020, 0.9)]);
    const generate = vi.fn(async ({ user }: { system: string, user: string }) => {
      if (user.includes("Boom")) throw new Error("timeout");
      return "OK PROSE";
    });
    const failed: Array<{ title: string, error?: string }> = [];

    const chapters = await synthesizeMasterBook(
      [{ number: 1, title: "First" }, { number: 2, title: "Boom" }, { number: 3, title: "Third" }],
      { retrieve, generate },
      { onProgress: (e) => { if (e.phase === "failed") failed.push({ title: e.title, error: e.error }); } },
    );

    expect(generate).toHaveBeenCalledTimes(3); // attempted all
    expect(chapters.map((c) => c.title)).toEqual(["First", "Third"]); // Boom skipped
    expect(chapters.map((c) => c.number)).toEqual([1, 2]); // renumbered around the failure
    expect(failed).toEqual([{ title: "Boom", error: "timeout" }]);
  });

  it("keeps going when a chapter's RETRIEVAL throws (slow/failed search)", async () => {
    const retrieve = vi.fn(async (q: string) => {
      if (q.includes("Boom")) throw new Error("Request timed out after 30000ms");
      return [P("p", "B", 2020, 0.9)];
    });
    const generate = vi.fn(async () => "PROSE");
    const failed: string[] = [];

    const chapters = await synthesizeMasterBook(
      [{ number: 1, title: "Boom" }, { number: 2, title: "Fine" }],
      { retrieve, generate },
      { onProgress: (e) => { if (e.phase === "failed") failed.push(e.title); } },
    );

    expect(chapters.map((c) => c.title)).toEqual(["Fine"]); // retrieval-failed chapter skipped
    expect(failed).toEqual(["Boom"]);
    expect(generate).toHaveBeenCalledTimes(1); // generate not attempted for the failed retrieval
  });

  it("skips a chapter whose retrieval is empty instead of hallucinating it", async () => {
    const retrieve = vi.fn(async (q: string) => (q.startsWith("Empty") ? [] : [P("p", "B", 2020)]));
    const generate = vi.fn(async () => "PROSE");
    const events: string[] = [];

    const chapters = await synthesizeMasterBook(
      [{ number: 1, title: "Empty Topic" }, { number: 2, title: "Real Topic" }],
      { retrieve, generate },
      { onProgress: (e) => { if (e.phase === "skipped-empty") events.push(e.title); } },
    );

    expect(generate).toHaveBeenCalledTimes(1); // only the non-empty chapter
    expect(chapters.map((c) => c.title)).toEqual(["Real Topic"]);
    expect(chapters[0].number).toBe(1); // renumbered after the skip
    expect(events).toEqual(["Empty Topic"]);
  });
});

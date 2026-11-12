/**
 * `divinci qa auto-fix patch` printed "Chunks proposed for addition: 0" for
 * every patch: it looked for chunks on the patch document, which carries none.
 * They come from the patch-chunks route as `{ page, total }`, the same shape
 * flagged-chunks uses. On 2026-10-02 a patch holding 3 chunks showed as empty —
 * a reviewer approving from the CLI would have approved content they never saw.
 */
import { describe, it, expect } from "vitest";
import { pagedList, escalatedQuestions } from "../../../../src/commands/qa/auto-fix";

describe("pagedList", ()=>{
  it("reads the page and total of a paged response", ()=>{
    const r = pagedList({ page: [{ text: "a" }, { text: "b" }], total: 7 });
    expect(r.items.map((c)=>c.text)).toEqual(["a", "b"]);
    expect(r.total).toBe(7);
  });

  it("does not report a patch document's own fields as chunks", ()=>{
    expect(pagedList({ _id: "p", status: "editing chunks", embeddingsAvailable: [] }))
      .toEqual({ items: [], total: 0 });
  });

  it("accepts a bare list and tolerates null", ()=>{
    expect(pagedList([{ text: "x" }]).total).toBe(1);
    expect(pagedList(null)).toEqual({ items: [], total: 0 });
  });
});

describe("escalatedQuestions", ()=>{
  const sel = { id: "@divinci-ai/jev-select-passage" };
  it("lists tests whose suggestors escalated instead of proposing a chunk", ()=>{
    const out = escalatedQuestions([
      { prompt: "Who discovered Comet Thatcher?", suggestions: { newRag: [], escalations: [{ confidence: 0.02, reasoning: "none", suggestor: sel }] } },
      { prompt: "How deep is Valles Marineris?", suggestions: { newRag: [{ text: "5 miles deep" }], escalations: [] } },
      { prompt: "Fixed by one suggestor, escalated by another", suggestions: { newRag: [{ text: "x" }], escalations: [{ confidence: 0.1, reasoning: "r", suggestor: sel }] } },
      { prompt: "No suggestions at all" },
    ]);
    expect(out).toEqual([{ prompt: "Who discovered Comet Thatcher?", confidence: 0.02, reasoning: "none" }]);
  });

  it("tolerates a missing or non-list response", ()=>{
    expect(escalatedQuestions(null)).toEqual([]);
    expect(escalatedQuestions({ error: "x" })).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";

import { parseCatalogSkills } from "../../../src/commands/release/update";

/**
 * `--catalog-skills` is keyed by WhitelabelSkill._id (an INSTANCE), not by the
 * catalog id. Passing `sms-release` is the natural mistake — it is the name in
 * the docs and in `skill_list_catalog` output — and server-side it comes back as
 * a generic "unowned skill id" rejection that does not explain what to do next.
 * These tests pin the local, actionable error.
 */
describe("parseCatalogSkills", ()=>{
  it("accepts a well-formed instance map", ()=>{
    const out = parseCatalogSkills('{"6a321d7a0004d6561592719b":["sendSms"]}');
    expect(out).toEqual({ "6a321d7a0004d6561592719b": ["sendSms"] });
  });

  it("accepts multiple actions and multiple instances", ()=>{
    const out = parseCatalogSkills(
      '{"6a321d7a0004d6561592719b":["sendSms"],"6a321d7a0004d6561592719c":["sendEmail","other"]}',
    );
    expect(Object.keys(out)).toHaveLength(2);
    expect(out["6a321d7a0004d6561592719c"]).toEqual(["sendEmail", "other"]);
  });

  it("rejects a CATALOG id with guidance instead of letting the server 400", ()=>{
    expect(()=>parseCatalogSkills('{"sms-release":["sendSms"]}'))
      .toThrow(/looks like a CATALOG id.*skill_create/s);
  });

  it("rejects malformed JSON with an example", ()=>{
    expect(()=>parseCatalogSkills("not json")).toThrow(/must be valid JSON/);
  });

  it("rejects a JSON array (must be an object map)", ()=>{
    expect(()=>parseCatalogSkills('["sendSms"]')).toThrow(/must be a JSON object/);
  });

  it("rejects non-array action values", ()=>{
    expect(()=>parseCatalogSkills('{"6a321d7a0004d6561592719b":"sendSms"}'))
      .toThrow(/must map to an array/);
  });

  it("rejects non-string entries inside the action array", ()=>{
    expect(()=>parseCatalogSkills('{"6a321d7a0004d6561592719b":[1]}'))
      .toThrow(/must map to an array/);
  });

  it("allows an empty action array (all actions of that instance)", ()=>{
    expect(parseCatalogSkills('{"6a321d7a0004d6561592719b":[]}'))
      .toEqual({ "6a321d7a0004d6561592719b": [] });
  });
});

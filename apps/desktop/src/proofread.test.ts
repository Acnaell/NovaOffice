import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { nextError, occurrenceKey } from "./proofread";
import { DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, type BlockView, type DocView } from "./types";

const p = (text: string): BlockView => ({
  style: "paragraph",
  attrs: { ...DEFAULT_ATTRS },
  spans: [{ text, marks: [] }],
});

const doc: DocView = {
  blocks: [p("um erro e otro erro"), p("mais um errro")],
  canUndo: false,
  canRedo: false,
  path: null,
  title: "t",
  dirty: false,
  format: null,
  page: DEFAULT_PAGE,
  headerFooter: DEFAULT_HEADER_FOOTER,
  footnotes: {},
};

// "otro" (0:10-14) e "errro" (1:8-13)
const matches = [
  { block: 0, start: 10, end: 14 },
  { block: 1, start: 8, end: 13 },
];
const none = { once: new Set<string>(), words: new Set<string>() };

describe("nextError", () => {
  it("começa no cursor", () => {
    expect(nextError(doc, matches, { block: 0, offset: 0 }, none)).toEqual(matches[0]);
    expect(nextError(doc, matches, { block: 0, offset: 10 }, none)).toEqual(matches[0]);
    expect(nextError(doc, matches, { block: 0, offset: 11 }, none)).toEqual(matches[1]);
  });

  it("dá a volta no documento", () => {
    expect(nextError(doc, matches, { block: 1, offset: 9 }, none)).toEqual(matches[0]);
  });

  it("pula o que foi ignorado", () => {
    const once = new Set([occurrenceKey(matches[0], "otro")]);
    expect(nextError(doc, matches, { block: 0, offset: 0 }, { once, words: new Set() })).toEqual(matches[1]);
    const words = new Set(["errro"]);
    expect(nextError(doc, matches, { block: 0, offset: 11 }, { once: new Set(), words })).toEqual(matches[0]);
  });

  it("sem erros, nada", () => {
    expect(nextError(doc, [], { block: 0, offset: 0 }, none)).toBeNull();
    expect(nextError(doc, matches, { block: 0, offset: 0 }, { once: new Set(), words: new Set(["otro", "errro"]) })).toBeNull();
  });
});

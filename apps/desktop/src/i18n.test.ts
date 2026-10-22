import { describe, expect, it } from "vitest";
import { format, initialLocale, LOCALES, translator } from "./i18n";

describe("idiomas", () => {
  it("todos os idiomas têm as mesmas chaves e nenhum texto vazio", () => {
    const reference = Object.keys(LOCALES["pt-BR"].messages).sort();
    for (const { messages } of Object.values(LOCALES)) {
      expect(Object.keys(messages).sort()).toEqual(reference);
      expect(Object.values(messages).every((m) => m.trim() !== "")).toBe(true);
    }
  });

  it("preenche parâmetros", () => {
    expect(format("{words} palavras", { words: 3 })).toBe("3 palavras");
    expect(format("{a} e {b}", { a: 1 })).toBe("1 e {b}");
    expect(translator("en")("status.savedTo", { path: "C:\\a.nova" })).toBe("Saved to C:\\a.nova");
  });

  it("escolhe o idioma inicial", () => {
    expect(initialLocale("en", ["pt-BR"])).toBe("en");
    expect(initialLocale("xx", ["en-US"])).toBe("en");
    expect(initialLocale(null, ["pt-PT"])).toBe("pt-BR");
    expect(initialLocale(null, ["de-DE"])).toBe("pt-BR");
  });
});

import { describe, expect, it } from "vitest";
import { autoCorrect, DEFAULT_AUTOCORRECT, parseAutoCorrect, type AutoCorrectOptions } from "./autocorrect";

/** Digita `text` letra por letra, aplicando as correções, como o App faz. */
function type(text: string, options: AutoCorrectOptions = DEFAULT_AUTOCORRECT): string {
  let doc = "";
  for (const ch of text) {
    doc += ch;
    const fix = autoCorrect(doc, doc.length, ch, options);
    if (fix) doc = doc.slice(0, fix.start) + fix.text + doc.slice(fix.end);
  }
  return doc;
}

describe("autoCorrect", () => {
  it("maiúscula no início da frase", () => {
    expect(type("frase. outra ")).toBe("Frase. Outra ");
    expect(type("isto é bom! e agora? sim. ")).toBe("Isto é bom! E agora? Sim. ");
    expect(type("  recuo ")).toBe("  Recuo ");
  });

  it("não mexe em abreviações, endereços e palavras no meio da frase", () => {
    expect(type("O Sr. silva chegou ")).toBe("O Sr. silva chegou ");
    expect(type("Veja p. ex. isto ")).toBe("Veja p. ex. isto ");
    expect(type("www.site.com ")).toBe("www.site.com ");
    expect(type("Item 1. texto ")).toBe("Item 1. texto ");
    expect(type("Ela disse oi ")).toBe("Ela disse oi ");
  });

  it("aspas inteligentes", () => {
    expect(type('Ele disse "oi" ')).toBe("Ele disse “oi” ");
    expect(type("It's 'ok' ")).toBe("It’s ‘ok’ ");
    expect(type('"Aspas" no início ')).toBe("“Aspas” no início ");
  });

  it("-- vira travessão", () => {
    expect(type("Isto--aquilo")).toBe("Isto—aquilo");
    expect(type("Isto -- aquilo")).toBe("Isto — aquilo");
    expect(type("Linha ---")).toBe("Linha ---");
  });

  it("lista de substituições", () => {
    expect(type("Marca (c) 2026 ")).toBe("Marca © 2026 ");
    expect(type("Espere... ")).toBe("Espere… ");
    const own: AutoCorrectOptions = { ...DEFAULT_AUTOCORRECT, replacements: [["nao", "não"]] };
    expect(type("Eu nao sei ", own)).toBe("Eu não sei ");
  });

  it("só corrige a palavra digitada agora", () => {
    expect(autoCorrect("início ", 7, " ", DEFAULT_AUTOCORRECT, false)).toBeNull();
    expect(autoCorrect("início ", 7, " ", DEFAULT_AUTOCORRECT, true)?.text).toBe("I");
  });

  it("cada opção desliga a sua correção", () => {
    const off: AutoCorrectOptions = { capitalize: false, smartQuotes: false, dashes: false, replaceText: false, replacements: [] };
    expect(type('frase. "a--b" (c) ', off)).toBe('frase. "a--b" (c) ');
  });

  it("lê as opções salvas e ignora lixo", () => {
    expect(parseAutoCorrect(null)).toEqual(DEFAULT_AUTOCORRECT);
    expect(parseAutoCorrect("{")).toEqual(DEFAULT_AUTOCORRECT);
    const saved = parseAutoCorrect(JSON.stringify({ capitalize: false, replacements: [["a", "b"], ["", "x"], [1, 2]] }));
    expect(saved.capitalize).toBe(false);
    expect(saved.smartQuotes).toBe(true);
    expect(saved.replacements).toEqual([["a", "b"]]);
  });
});

import { describe, expect, it } from "vitest";
import { checkDue, DAY_MS, parseInline, parseMarkdown, percent } from "./update";

describe("quando procurar atualizações", () => {
  it("uma vez por dia", () => {
    const last = Date.UTC(2026, 9, 23, 9);
    expect(checkDue(last + DAY_MS - 1, last)).toBe(false);
    expect(checkDue(last + DAY_MS, last)).toBe(true);
    expect(checkDue(last, 0)).toBe(true);
    // Relógio atrasado: consulta de novo em vez de esperar até a data antiga.
    expect(checkDue(last - 1000, last)).toBe(true);
  });

  it("porcentagem do download", () => {
    expect(percent({ received: 0, total: 0 })).toBe(0);
    expect(percent({ received: 512, total: 1024 })).toBe(50);
    expect(percent({ received: 1023, total: 1024 })).toBe(99);
    expect(percent({ received: 2000, total: 1024 })).toBe(100);
  });
});

describe("notas da release em Markdown", () => {
  it("negrito, código, links e itálico, sem virar HTML", () => {
    expect(parseInline("Aba **Exibir** com `zoom` e <b>x</b>")).toEqual([
      { kind: "text", text: "Aba " },
      { kind: "bold", text: "Exibir" },
      { kind: "text", text: " com " },
      { kind: "code", text: "zoom" },
      { kind: "text", text: " e <b>x</b>" },
    ]);
    expect(parseInline("[PR #9](https://github.com/Acnaell/NovaOffice/pull/9) de _hoje_")).toEqual([
      { kind: "link", text: "PR #9", href: "https://github.com/Acnaell/NovaOffice/pull/9" },
      { kind: "text", text: " de " },
      { kind: "italic", text: "hoje" },
    ]);
    expect(parseInline("nova_spell_check")).toEqual([{ kind: "text", text: "nova_spell_check" }]);
    // Links só http(s): nada de javascript:.
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
  });

  it("notas geradas pelo GitHub", () => {
    const notes = [
      "## O que mudou",
      "* Aba Revisão by @Acnaell in https://github.com/Acnaell/NovaOffice/pull/6",
      "* Contar Palavras",
      "",
      "1. Primeiro",
      "2. Segundo",
      "",
      "---",
      "**Full Changelog**: https://github.com/Acnaell/NovaOffice/compare/v0.1.5...v0.1.6",
      "continua aqui",
    ].join("\r\n");
    const blocks = parseMarkdown(notes);
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "list", "paragraph"]);
    expect(blocks[0]).toEqual({ kind: "heading", level: 2, content: [{ kind: "text", text: "O que mudou" }] });
    const bullets = blocks[1];
    expect(bullets.kind === "list" && !bullets.ordered && bullets.items.length).toBe(2);
    expect(bullets.kind === "list" && bullets.items[0].at(-1)).toEqual({
      kind: "link",
      text: "https://github.com/Acnaell/NovaOffice/pull/6",
      href: "https://github.com/Acnaell/NovaOffice/pull/6",
    });
    expect(blocks[2].kind === "list" && blocks[2].ordered).toBe(true);
    const last = blocks[3];
    expect(last.kind === "paragraph" && last.content.at(-1)).toEqual({ kind: "text", text: " continua aqui" });
  });

  it("títulos muito fundos viram nível 3", () => {
    expect(parseMarkdown("##### Detalhes ##")).toEqual([{ kind: "heading", level: 3, content: [{ kind: "text", text: "Detalhes" }] }]);
    expect(parseMarkdown("")).toEqual([]);
  });
});

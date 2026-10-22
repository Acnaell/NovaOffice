import { describe, expect, it } from "vitest";
import { matchShortcut, parseCombo, PROFILES, profileFor, withShortcut, type Profile } from "./shortcuts";

const key = (init: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", keyCode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;
const ctrl = (letter: string, extra: Partial<KeyboardEvent> = {}) =>
  key({ key: letter, code: `Key${letter.toUpperCase()}`, ctrlKey: true, ...extra });

describe("atalhos", () => {
  it("lê combinações", () => {
    expect(parseCombo("Ctrl+Shift+S")).toEqual({ ctrl: true, alt: false, shift: true, key: "s" });
    expect(parseCombo("Alt+Shift+5")).toEqual({ ctrl: false, alt: true, shift: true, key: "5" });
  });

  it("Word em português: Ctrl+N negrito, Ctrl+S sublinhado, Ctrl+B salvar, Ctrl+T selecionar tudo", () => {
    const pt = (e: KeyboardEvent) => matchShortcut(e, "word-pt");
    expect(pt(ctrl("n"))).toBe("format.bold");
    expect(pt(ctrl("s"))).toBe("format.underline");
    expect(pt(ctrl("b"))).toBe("file.save");
    expect(pt(ctrl("o"))).toBe("file.new");
    expect(pt(ctrl("a"))).toBe("file.open");
    expect(pt(ctrl("t"))).toBe("edit.selectAll");
    expect(pt(ctrl("l"))).toBe("edit.find");
    expect(pt(ctrl("u"))).toBe("edit.replace");
    expect(pt(ctrl("e"))).toBe("para.alignCenter");
    expect(pt(ctrl("q"))).toBe("para.alignLeft");
    expect(pt(ctrl("g"))).toBe("para.alignRight");
    expect(pt(ctrl("j"))).toBe("para.justify");
    expect(pt(ctrl("r"))).toBe("edit.redo");
  });

  it("Word em inglês: Ctrl+B negrito, Ctrl+U sublinhado, Ctrl+S salvar", () => {
    const en = (e: KeyboardEvent) => matchShortcut(e, "word-en");
    expect(en(ctrl("b"))).toBe("format.bold");
    expect(en(ctrl("u"))).toBe("format.underline");
    expect(en(ctrl("s"))).toBe("file.save");
    expect(en(ctrl("s", { shiftKey: true, key: "S" }))).toBe("file.saveAs");
    expect(en(ctrl("l"))).toBe("para.alignLeft");
    expect(en(ctrl("r"))).toBe("para.alignRight");
  });

  it("o perfil acompanha o idioma", () => {
    expect(profileFor("pt-BR")).toBe("word-pt");
    expect(profileFor("en")).toBe("word-en");
  });

  it("exige exatamente os modificadores", () => {
    expect(matchShortcut(key({ key: "s", code: "KeyS" }))).toBeNull();
    expect(matchShortcut(ctrl("b", { altKey: true }))).toBeNull();
  });

  it("aceita Cmd no lugar de Ctrl e segue o layout nas letras", () => {
    expect(matchShortcut(key({ key: "z", code: "KeyZ", metaKey: true }))).toBe("edit.undo");
    // AZERTY: a tecla física KeyW digita "z".
    expect(matchShortcut(key({ key: "z", code: "KeyW", ctrlKey: true }))).toBe("edit.undo");
  });

  it("dígitos e pontuação pela tecla física (ABNT2, Shift)", () => {
    expect(matchShortcut(key({ key: "¹", code: "Digit1", ctrlKey: true, altKey: true }))).toBe("style.heading1");
    expect(matchShortcut(key({ key: "%", code: "Digit5", altKey: true, shiftKey: true }))).toBe("format.strike");
    expect(matchShortcut(key({ key: "¹", keyCode: 49, ctrlKey: true, altKey: true }))).toBe("style.heading1");
    expect(matchShortcut(key({ key: "=", code: "Equal", ctrlKey: true }))).toBe("format.subscript");
    expect(matchShortcut(key({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }))).toBe("format.superscript");
    expect(matchShortcut(key({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }))).toBe("format.grow");
    expect(matchShortcut(key({ key: " ", code: "Space", ctrlKey: true }))).toBe("format.clear");
    expect(matchShortcut(key({ key: "F3", code: "F3", shiftKey: true }))).toBe("format.case");
    expect(matchShortcut(key({ key: "F12", code: "F12" }), "word-pt")).toBe("file.saveAs");
  });

  it("mostra o atalho principal na dica, no formato legível", () => {
    expect(withShortcut("Negrito", "format.bold", "word-pt")).toBe("Negrito (Ctrl+N)");
    expect(withShortcut("Subscrito", "format.subscript", "word-pt")).toBe("Subscrito (Ctrl+=)");
    expect(withShortcut("Pincel", "format.painter", "word-pt")).toBe("Pincel");
  });

  it("nenhum perfil tem a mesma combinação em dois comandos", () => {
    for (const profile of Object.keys(PROFILES) as Profile[]) {
      const all = Object.values(PROFILES[profile]).flat().map((c) => c!.toLowerCase());
      const dupes = all.filter((c, i) => all.indexOf(c) !== i);
      expect(dupes, profile).toEqual([]);
    }
  });
});

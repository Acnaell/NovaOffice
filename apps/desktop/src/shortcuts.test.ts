import { describe, expect, it } from "vitest";
import { BINDINGS, matchShortcut, parseCombo, withShortcut } from "./shortcuts";

const key = (init: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", keyCode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

describe("atalhos", () => {
  it("lê combinações", () => {
    expect(parseCombo("Ctrl+Shift+S")).toEqual({ ctrl: true, alt: false, shift: true, key: "s" });
    expect(parseCombo("Alt+Shift+5")).toEqual({ ctrl: false, alt: true, shift: true, key: "5" });
  });

  it("exige exatamente os modificadores da combinação", () => {
    expect(matchShortcut(key({ key: "s", code: "KeyS", ctrlKey: true }))).toBe("file.save");
    expect(matchShortcut(key({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true }))).toBe("file.saveAs");
    expect(matchShortcut(key({ key: "s", code: "KeyS" }))).toBeNull();
    expect(matchShortcut(key({ key: "b", code: "KeyB", ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("aceita Cmd no lugar de Ctrl", () => {
    expect(matchShortcut(key({ key: "z", code: "KeyZ", metaKey: true }))).toBe("edit.undo");
  });

  it("segue o layout nas letras", () => {
    // AZERTY: a tecla física KeyW digita "z".
    expect(matchShortcut(key({ key: "z", code: "KeyW", ctrlKey: true }))).toBe("edit.undo");
  });

  it("usa a tecla física quando Ctrl+Alt vira AltGr (ABNT2)", () => {
    expect(matchShortcut(key({ key: "¹", code: "Digit1", ctrlKey: true, altKey: true }))).toBe("style.heading1");
    expect(matchShortcut(key({ key: "%", code: "Digit5", altKey: true, shiftKey: true }))).toBe("format.strike");
    expect(matchShortcut(key({ key: "¹", keyCode: 49, ctrlKey: true, altKey: true }))).toBe("style.heading1");
  });

  it("mostra o atalho principal na dica", () => {
    expect(withShortcut("Refazer", "edit.redo")).toBe(`Refazer (${BINDINGS["edit.redo"]![0]})`);
    expect(withShortcut("Citação", "style.quote")).toBe("Citação");
  });

  it("não tem a mesma combinação em dois comandos", () => {
    const all = Object.values(BINDINGS).flat().map((c) => c!.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });
});

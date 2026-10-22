import { describe, expect, it } from "vitest";
import { DEFAULT_ATTRS } from "./formatting";
import { caret, deleteBackward, deleteForward, deleteRange, type Selection } from "./model";
import { deleteColumns, deleteRows, deleteTable, insertColumn, insertRow, insertTable, moveToCell, tableAt } from "./tables";
import type { BlockView, CellRef, DocView, TextCommand } from "./types";

const doc = (...blocks: BlockView[]): DocView => ({ blocks, canUndo: false, canRedo: false, path: null, title: "t", dirty: false, format: null });
const p = (text: string, cell: CellRef | null = null): BlockView => ({
  style: "paragraph",
  attrs: { ...DEFAULT_ATTRS, cell },
  spans: text ? [{ text, marks: [] }] : [],
});
const at = (block: number, offset = 0): Selection => caret({ block, offset });

/** Aplica os comandos de estrutura como o núcleo faria (o suficiente para conferir tabelas). */
function apply(d: DocView, command: TextCommand | null): DocView {
  const blocks = d.blocks.map((b) => ({ ...b, attrs: { ...b.attrs }, spans: b.spans.map((s) => ({ ...s })) }));
  const run = (c: TextCommand) => {
    switch (c.type) {
      case "batch":
        return c.commands.forEach(run);
      case "block.insert":
        return blocks.splice(c.index, 0, p(c.text));
      case "block.remove":
        return blocks.splice(c.block, 1);
      case "block.setAttr":
        return void ((blocks[c.block].attrs as unknown as Record<string, unknown>)[c.attr] = c.value);
      case "text.delete": {
        const text = blocks[c.block].spans.map((s) => s.text).join("");
        const rest = text.slice(0, c.offset) + text.slice(c.offset + c.len);
        blocks[c.block].spans = rest ? [{ text: rest, marks: [] }] : [];
        return;
      }
      default:
        throw new Error(`comando não simulado: ${c.type}`);
    }
  };
  if (command) run(command);
  return { ...d, blocks };
}

/** A tabela como grade de textos, para comparar. */
function grid(d: DocView, block: number): string[][] {
  const t = tableAt(d, block)!;
  return Array.from({ length: t.rows }, (_, r) =>
    Array.from({ length: t.cols }, (_, c) => (t.cells.get(`${r}:${c}`) ?? []).map((i) => d.blocks[i].spans.map((s) => s.text).join("")).join("/")),
  );
}

const c = (row: number, col: number): CellRef => ({ table: "t", row, col });
const table2x2 = () => doc(p("antes"), p("a", c(0, 0)), p("b", c(0, 1)), p("c", c(1, 0)), p("d", c(1, 1)), p("depois"));

describe("tabelas", () => {
  it("insere no parágrafo vazio e deixa um parágrafo depois", () => {
    const d = apply(doc(p("x"), p("")), insertTable(doc(p("x"), p("")), at(1), 2, 3, "t9").command);
    expect(d.blocks.length).toBe(1 + 6 + 1);
    expect(d.blocks[1].attrs.cell).toEqual({ table: "t9", row: 0, col: 0 });
    expect(d.blocks[6].attrs.cell).toEqual({ table: "t9", row: 1, col: 2 });
    expect(d.blocks[7].attrs.cell).toBeNull();
    // Num parágrafo com texto, a tabela vem depois dele.
    const d2 = apply(doc(p("texto")), insertTable(doc(p("texto")), at(0, 2), 1, 1, "t1").command);
    expect(d2.blocks.map((b) => !!b.attrs.cell)).toEqual([false, true, false]);
  });

  it("Tab percorre as células e cria linha na última", () => {
    const d = table2x2();
    expect(moveToCell(d, at(1), false)!.selection).toEqual({ anchor: { block: 2, offset: 0 }, focus: { block: 2, offset: 1 } });
    expect(moveToCell(d, at(3), true)!.selection.focus.block).toBe(2);
    const added = moveToCell(d, at(4), false)!;
    const d2 = apply(d, added.command);
    expect(grid(d2, 1)).toEqual([["a", "b"], ["c", "d"], ["", ""]]);
    expect(added.selection.focus.block).toBe(5);
  });

  it("insere e exclui linhas e colunas", () => {
    const d = table2x2();
    expect(grid(apply(d, insertRow(d, at(1), false)!.command), 1)).toEqual([["", ""], ["a", "b"], ["c", "d"]]);
    expect(grid(apply(d, insertRow(d, at(1), true)!.command), 1)).toEqual([["a", "b"], ["", ""], ["c", "d"]]);
    expect(grid(apply(d, insertColumn(d, at(2), true)!.command), 1)).toEqual([["a", "b", ""], ["c", "d", ""]]);
    expect(grid(apply(d, insertColumn(d, at(4), false)!.command), 1)).toEqual([["a", "", "b"], ["c", "", "d"]]);
    expect(grid(apply(d, insertColumn(d, at(3), false)!.command), 1)).toEqual([["", "a", "b"], ["", "c", "d"]]);
    expect(grid(apply(d, deleteRows(d, at(1))!.command), 1)).toEqual([["c", "d"]]);
    expect(grid(apply(d, deleteColumns(d, at(3))!.command), 1)).toEqual([["b"], ["d"]]);
    const gone = apply(d, deleteTable(d, at(2))!.command);
    expect(gone.blocks.map((b) => b.spans[0]?.text)).toEqual(["antes", "depois"]);
  });

  it("Backspace e Delete não juntam células; seleção entre células apaga só o texto", () => {
    const d = table2x2();
    expect(deleteBackward(d, at(2)).command).toBeNull();
    expect(deleteForward(d, at(1, 1)).command).toBeNull();
    // Depois da tabela, Backspace leva o cursor para a última célula.
    expect(deleteBackward(d, at(5)).selection).toEqual(at(4, 1));
    const cleared = apply(d, deleteRange({ block: 1, offset: 0 }, { block: 3, offset: 1 }, d).command);
    expect(grid(cleared, 1)).toEqual([["", ""], ["", "d"]]);
  });
});

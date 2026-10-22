// Tabelas. Cada célula é um ou mais parágrafos com `attrs.cell` (tabela,
// linha, coluna), em ordem de linha e coluna; a tabela é a sequência de
// parágrafos com o mesmo id. Assim o cursor, a seleção, copiar e colar e o
// desfazer funcionam como em qualquer parágrafo. Sem DOM; testado em tables.test.ts.

import { blockText, caret, type Edit, type Selection } from "./model";
import type { CellRef, DocView, TextCommand } from "./types";

/** Maior grade que o seletor oferece e que os comandos aceitam (o núcleo vai até 1000). */
export const MAX_ROWS = 200;
export const MAX_COLS = 63;

export function newTableId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface TableInfo {
  id: string;
  /** Primeiro parágrafo e o seguinte ao último. */
  start: number;
  end: number;
  rows: number;
  cols: number;
  /** Parágrafos de cada célula, por "linha:coluna". */
  cells: Map<string, number[]>;
}

const key = (row: number, col: number) => `${row}:${col}`;

/** A tabela que contém o parágrafo, ou null. */
export function tableAt(doc: DocView, block: number): TableInfo | null {
  const id = doc.blocks[block]?.attrs.cell?.table;
  if (!id) return null;
  let start = block;
  while (start > 0 && doc.blocks[start - 1].attrs.cell?.table === id) start--;
  let end = block + 1;
  while (end < doc.blocks.length && doc.blocks[end].attrs.cell?.table === id) end++;
  const cells = new Map<string, number[]>();
  let rows = 0;
  let cols = 0;
  for (let i = start; i < end; i++) {
    const c = doc.blocks[i].attrs.cell!;
    rows = Math.max(rows, c.row + 1);
    cols = Math.max(cols, c.col + 1);
    const k = key(c.row, c.col);
    cells.set(k, [...(cells.get(k) ?? []), i]);
  }
  return { id, start, end, rows, cols, cells };
}

/** Os dois parágrafos estão na mesma célula? */
export function sameCell(a: CellRef | null | undefined, b: CellRef | null | undefined): boolean {
  if (!a && !b) return true;
  return !!a && !!b && a.table === b.table && a.row === b.row && a.col === b.col;
}

const cellAttr = (block: number, cell: CellRef | null): TextCommand => ({ type: "block.setAttr", block, attr: "cell", value: cell });

/**
 * Inserir → Tabela: a tabela entra depois do parágrafo do cursor (ou no lugar
 * dele, se estiver vazio), e sempre fica um parágrafo comum depois dela.
 */
export function insertTable(doc: DocView, sel: Selection, rows: number, cols: number, id = newTableId()): Edit {
  rows = Math.max(1, Math.min(rows, MAX_ROWS));
  cols = Math.max(1, Math.min(cols, MAX_COLS));
  const at = sel.focus.block;
  const current = doc.blocks[at];
  const commands: TextCommand[] = [];
  // Dentro de outra tabela, a nova vai depois dela (o Nova não aninha tabelas).
  const inTable = tableAt(doc, at);
  const reuse = !inTable && blockText(current) === "" && current.style === "paragraph" && !current.attrs.list;
  let index = inTable ? inTable.end : reuse ? at : at + 1;
  const first = index;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!(reuse && index === at)) commands.push({ type: "block.insert", index, text: "" });
      commands.push(cellAttr(index, { table: id, row: r, col: c }));
      index++;
    }
  }
  // Parágrafo depois da tabela: o atual (se foi reaproveitado, entra um novo) ou o que já vem a seguir.
  const after = doc.blocks[reuse ? at + 1 : inTable ? inTable.end : at + 1];
  if (reuse || !after || after.attrs.cell) commands.push({ type: "block.insert", index, text: "" });
  return { command: { type: "batch", commands }, selection: caret({ block: first, offset: 0 }) };
}

/** Seleciona o conteúdo do primeiro parágrafo da célula, como o Tab do Word. */
function selectCell(doc: DocView, block: number): Selection {
  return { anchor: { block, offset: 0 }, focus: { block, offset: blockText(doc.blocks[block]).length } };
}

/** Tab e Shift+Tab: próxima célula ou anterior; Tab na última célula cria uma linha. */
export function moveToCell(doc: DocView, sel: Selection, backward: boolean): Edit | null {
  const block = sel.focus.block;
  const t = tableAt(doc, block);
  const cell = doc.blocks[block].attrs.cell;
  if (!t || !cell) return null;
  let index = cell.row * t.cols + cell.col + (backward ? -1 : 1);
  while (index >= 0 && index < t.rows * t.cols) {
    const target = t.cells.get(key(Math.floor(index / t.cols), index % t.cols));
    if (target) return { command: null, selection: selectCell(doc, target[0]) };
    index += backward ? -1 : 1;
  }
  if (backward) return { command: null, selection: sel };
  const added = insertRow(doc, { anchor: { block: t.end - 1, offset: 0 }, focus: { block: t.end - 1, offset: 0 } }, true);
  return added && { command: added.command, selection: caret({ block: t.end, offset: 0 }) };
}

/** Inserir Acima / Inserir Abaixo. */
export function insertRow(doc: DocView, sel: Selection, below: boolean): Edit | null {
  const block = sel.focus.block;
  const t = tableAt(doc, block);
  const cell = doc.blocks[block].attrs.cell;
  if (!t || !cell || t.rows >= MAX_ROWS) return null;
  const row = below ? cell.row + 1 : cell.row;
  const commands: TextCommand[] = [];
  // Renumera as linhas de baixo (do fim para o começo, os índices não mudam) e insere a nova.
  for (let i = t.end - 1; i >= t.start; i--) {
    const c = doc.blocks[i].attrs.cell!;
    if (c.row >= row) commands.push(cellAttr(i, { ...c, row: c.row + 1 }));
  }
  let index = t.start;
  while (index < t.end && doc.blocks[index].attrs.cell!.row < row) index++;
  for (let c = 0; c < t.cols; c++) {
    commands.push({ type: "block.insert", index: index + c, text: "" }, cellAttr(index + c, { table: t.id, row, col: c }));
  }
  return { command: { type: "batch", commands }, selection: caret({ block: index, offset: 0 }) };
}

/** Inserir à Esquerda / Inserir à Direita. */
export function insertColumn(doc: DocView, sel: Selection, right: boolean): Edit | null {
  const block = sel.focus.block;
  const t = tableAt(doc, block);
  const cell = doc.blocks[block].attrs.cell;
  if (!t || !cell || t.cols >= MAX_COLS) return null;
  const col = right ? cell.col + 1 : cell.col;
  const commands: TextCommand[] = [];
  let caretAt = block;
  // Linha por linha, de baixo para cima: renumera as colunas à direita e insere a nova célula.
  for (let r = t.rows - 1; r >= 0; r--) {
    const rowBlocks: number[] = [];
    for (let i = t.start; i < t.end; i++) if (doc.blocks[i].attrs.cell!.row === r) rowBlocks.push(i);
    for (const i of rowBlocks) {
      const c = doc.blocks[i].attrs.cell!;
      if (c.col >= col) commands.push(cellAttr(i, { ...c, col: c.col + 1 }));
    }
    const firstRight = rowBlocks.find((i) => doc.blocks[i].attrs.cell!.col >= col);
    const index = firstRight ?? (rowBlocks.length ? rowBlocks[rowBlocks.length - 1] + 1 : t.start);
    commands.push({ type: "block.insert", index, text: "" }, cellAttr(index, { table: t.id, row: r, col }));
    if (r === cell.row) caretAt = index;
  }
  // Inserções nas linhas de baixo não mudam o índice da célula do cursor; as de cima mudam.
  const shift = cell.row;
  return { command: { type: "batch", commands }, selection: caret({ block: caretAt + shift, offset: 0 }) };
}

function removeBlocks(doc: DocView, indices: number[], keepOne: boolean): TextCommand[] {
  const commands: TextCommand[] = [];
  const sorted = [...indices].sort((a, b) => b - a);
  // O documento precisa de pelo menos um parágrafo.
  if (keepOne && sorted.length >= doc.blocks.length) {
    const last = sorted.pop()!;
    commands.push(...sorted.map((block) => ({ type: "block.remove", block }) as TextCommand));
    commands.push(cellAttr(last, null), { type: "text.delete", block: last - 0, offset: 0, len: blockText(doc.blocks[last]).length });
    return commands;
  }
  return sorted.map((block) => ({ type: "block.remove", block }) as TextCommand);
}

/** Excluir Linhas: as linhas da seleção. */
export function deleteRows(doc: DocView, sel: Selection): Edit | null {
  const t = tableAt(doc, sel.focus.block);
  if (!t) return null;
  const rowsOf = (b: number) => doc.blocks[b].attrs.cell?.row;
  const lo = Math.min(rowsOf(sel.anchor.block) ?? rowsOf(sel.focus.block)!, rowsOf(sel.focus.block)!);
  const hi = Math.max(rowsOf(sel.anchor.block) ?? lo, rowsOf(sel.focus.block)!);
  if (lo === 0 && hi === t.rows - 1) return deleteTable(doc, sel);
  const doomed: number[] = [];
  const commands: TextCommand[] = [];
  for (let i = t.end - 1; i >= t.start; i--) {
    const c = doc.blocks[i].attrs.cell!;
    if (c.row > hi) commands.push(cellAttr(i, { ...c, row: c.row - (hi - lo + 1) }));
    else if (c.row >= lo) doomed.push(i);
  }
  commands.push(...removeBlocks(doc, doomed, false));
  const first = Math.min(...doomed);
  const target = first < t.end - doomed.length ? first : Math.max(t.start, first - 1);
  return { command: { type: "batch", commands }, selection: caret({ block: target, offset: 0 }) };
}

/** Excluir Colunas: as colunas da seleção. */
export function deleteColumns(doc: DocView, sel: Selection): Edit | null {
  const t = tableAt(doc, sel.focus.block);
  if (!t) return null;
  const colOf = (b: number) => doc.blocks[b].attrs.cell?.col;
  const a = colOf(sel.anchor.block) ?? colOf(sel.focus.block)!;
  const lo = Math.min(a, colOf(sel.focus.block)!);
  const hi = Math.max(a, colOf(sel.focus.block)!);
  if (lo === 0 && hi === t.cols - 1) return deleteTable(doc, sel);
  const doomed: number[] = [];
  const commands: TextCommand[] = [];
  for (let i = t.end - 1; i >= t.start; i--) {
    const c = doc.blocks[i].attrs.cell!;
    if (c.col > hi) commands.push(cellAttr(i, { ...c, col: c.col - (hi - lo + 1) }));
    else if (c.col >= lo) doomed.push(i);
  }
  commands.push(...removeBlocks(doc, doomed, false));
  return { command: { type: "batch", commands }, selection: caret({ block: t.start, offset: 0 }) };
}

/** Excluir Tabela. */
export function deleteTable(doc: DocView, sel: Selection): Edit | null {
  const t = tableAt(doc, sel.focus.block);
  if (!t) return null;
  const indices = Array.from({ length: t.end - t.start }, (_, i) => t.start + i);
  const commands = removeBlocks(doc, indices, true);
  const target = Math.min(t.start, doc.blocks.length - indices.length);
  return { command: { type: "batch", commands }, selection: caret({ block: Math.max(0, target), offset: 0 }) };
}

/** Os parágrafos de uma tabela em grade, para desenhar: [linha][coluna] → índices. */
export function tableGrid(doc: { blocks: DocView["blocks"] }, start: number, end: number): number[][][] {
  let rows = 0;
  let cols = 0;
  for (let i = start; i < end; i++) {
    const c = doc.blocks[i].attrs.cell!;
    rows = Math.max(rows, c.row + 1);
    cols = Math.max(cols, c.col + 1);
  }
  const grid: number[][][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
  for (let i = start; i < end; i++) {
    const c = doc.blocks[i].attrs.cell!;
    grid[c.row][c.col].push(i);
  }
  return grid;
}


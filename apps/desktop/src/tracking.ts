// Controlar Alterações (Revisão; ADR 0015).
// Com o controle ligado, as edições vão para o núcleo dentro de um comando
// `tracked` (autor e data): o núcleo marca o texto inserido (`ins`) e deixa o
// excluído riscado (`del`). Aceitar e rejeitar viram comandos comuns.

import { caret, type Edit, type Selection } from "./model";
import type { BlockView, DocView, Mark, Pos, TextCommand } from "./types";

/** Comandos que mexem no texto e por isso entram no controle. */
const TEXT_EDITS = new Set<TextCommand["type"]>(["text.insert", "text.delete", "text.deleteRange", "block.remove"]);

/** Comandos que não fazem sentido dentro de `tracked` (o núcleo recusa). */
const NEVER = new Set<TextCommand["type"]>(["history.undo", "history.redo", "batch", "tracked"]);

/**
 * Embrulha a edição em `tracked` quando ela mexe no texto. Lotes viram um
 * `tracked` com os mesmos comandos (um passo de desfazer).
 */
export function trackedCommand(command: TextCommand, author: string, date: string): TextCommand {
  const list = command.type === "batch" ? command.commands : [command];
  if (NEVER.has(command.type) && command.type !== "batch") return command;
  if (!list.some((c) => TEXT_EDITS.has(c.type)) || list.some((c) => NEVER.has(c.type))) return command;
  return { type: "tracked", author, date, commands: list };
}

export function revisionOf(marks: Mark[]): Extract<Mark, { mark: "ins" | "del" }> | null {
  for (const m of marks) if (m.mark === "ins" || m.mark === "del") return m;
  return null;
}

/** Uma alteração no texto: trecho contínuo do mesmo autor, data e tipo. */
export interface Revision {
  block: number;
  offset: number;
  len: number;
  insert: boolean;
  author: string;
  date: string;
}

export function revisions(blocks: BlockView[]): Revision[] {
  const out: Revision[] = [];
  blocks.forEach((b, block) => {
    let offset = 0;
    for (const s of b.spans) {
      const r = revisionOf(s.marks);
      if (r) {
        const last = out[out.length - 1];
        const insert = r.mark === "ins";
        if (last && last.block === block && last.offset + last.len === offset && last.insert === insert && last.author === r.author && last.date === r.date) {
          last.len += s.text.length;
        } else {
          out.push({ block, offset, len: s.text.length, insert, author: r.author, date: r.date });
        }
      }
      offset += s.text.length;
    }
  });
  return out;
}

const cmp = (a: Pos, b: Pos) => a.block - b.block || a.offset - b.offset;
const startOf = (r: Revision): Pos => ({ block: r.block, offset: r.offset });
const endOf = (r: Revision): Pos => ({ block: r.block, offset: r.offset + r.len });

/** Alterações que a seleção toca (ou a do cursor). */
export function revisionsIn(list: Revision[], sel: Selection): Revision[] {
  const [from, to] = cmp(sel.anchor, sel.focus) <= 0 ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
  const collapsed = cmp(from, to) === 0;
  return list.filter((r) =>
    collapsed ? cmp(startOf(r), from) <= 0 && cmp(from, endOf(r)) <= 0 : cmp(startOf(r), to) < 0 && cmp(from, endOf(r)) < 0,
  );
}

/**
 * Comandos que aceitam (ou rejeitam) as alterações: aceitar uma inserção tira a
 * marca, aceitar uma exclusão apaga o texto; rejeitar faz o contrário. De trás
 * para a frente, para as posições não mudarem.
 */
export function resolveCommands(list: Revision[], accept: boolean): TextCommand[] {
  return [...list]
    .sort((a, b) => cmp(startOf(b), startOf(a)))
    .map((r): TextCommand =>
      r.insert === accept
        ? { type: "text.removeMark", block: r.block, offset: r.offset, len: r.len, kind: r.insert ? "ins" : "del" }
        : { type: "text.delete", block: r.block, offset: r.offset, len: r.len },
    );
}

/** Próxima (ou anterior) alteração a partir do cursor. */
export function nextRevision(list: Revision[], sel: Selection, back = false): Revision | null {
  const from = cmp(sel.anchor, sel.focus) <= 0 ? sel.anchor : sel.focus;
  if (back) {
    const before = list.filter((r) => cmp(startOf(r), from) < 0);
    return before[before.length - 1] ?? null;
  }
  const selected = (r: Revision) => cmp(sel.anchor, startOf(r)) === 0 && cmp(sel.focus, endOf(r)) === 0;
  return list.find((r) => cmp(startOf(r), sel.focus) >= 0 && !selected(r)) ?? null;
}

export const selectRevision = (r: Revision): Selection => ({ anchor: startOf(r), focus: endOf(r) });

/**
 * Aceitar ou rejeitar as alterações da seleção (ou do cursor); `all` pega o
 * documento todo; `andNext` vai para a próxima depois.
 */
export function resolveEdit(doc: DocView, sel: Selection, accept: boolean, opts: { all?: boolean; andNext?: boolean } = {}): Edit | null {
  const list = revisions(doc.blocks);
  const chosen = opts.all ? list : revisionsIn(list, sel);
  if (!chosen.length) {
    const next = nextRevision(list, sel);
    return next ? { command: null, selection: selectRevision(next) } : null;
  }
  const commands = resolveCommands(chosen, accept);
  // Para onde o cursor vai: o começo da primeira alteração resolvida.
  const first = chosen.reduce((a, b) => (cmp(startOf(a), startOf(b)) <= 0 ? a : b));
  return { command: { type: "batch", commands }, selection: caret(startOf(first)), untracked: true };
}

/** Cor de cada autor (a mesma pessoa sempre na mesma cor), como no Word. */
const COLORS = ["#C0392B", "#1F6FB2", "#2E8B57", "#8E44AD", "#C0640C", "#0E7C86", "#B03A7A", "#6B6B00"];
export function authorColor(author: string): string {
  let h = 0;
  for (const c of author) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Data de agora no formato guardado (ISO 8601, UTC, sem frações). */
export const revisionDate = (now = new Date()) => now.toISOString().replace(/\.\d+Z$/, "Z");

/** Como as alterações aparecem: Toda a Marcação, Sem Marcação (como ficaria aceitando tudo) ou Original. */
export type Markup = "all" | "none" | "original";

/**
 * Cursor depois de uma edição controlada: o texto "excluído" continua no
 * documento, então o cursor calculado pela interface (como se ele tivesse saído)
 * pode cair no lugar errado. Se a edição inseriu texto e o cursor é um ponto,
 * ele vai para logo depois do último texto inserido.
 */
export function trackedSelection(events: unknown[], wanted: Selection): Selection {
  if (wanted.anchor.block !== wanted.focus.block || wanted.anchor.offset !== wanted.focus.offset) return wanted;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as { type?: string; block?: number; offset?: number; len?: number };
    if (e.type === "blockSplit" || e.type === "blockInserted") return wanted;
    if (e.type === "textInserted" && typeof e.block === "number" && typeof e.offset === "number" && typeof e.len === "number") {
      return caret({ block: e.block, offset: e.offset + e.len });
    }
  }
  return wanted;
}

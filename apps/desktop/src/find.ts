// Localizar e substituir (Ctrl+L / Ctrl+U no Word em português).

import { marksAt, blockText, type Selection } from "./model";
import type { DocView, Pos, TextCommand } from "./types";

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export interface Match {
  block: number;
  start: number;
  end: number;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Todas as ocorrências, na ordem do documento. Não atravessa parágrafos (como no Word). */
export function findAll(doc: DocView, query: string, opts: FindOptions): Match[] {
  if (!query) return [];
  const body = escapeRegExp(query);
  const pattern = opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  const re = new RegExp(pattern, opts.matchCase ? "gu" : "giu");
  const out: Match[] = [];
  doc.blocks.forEach((b, block) => {
    for (const m of blockText(b).matchAll(re)) {
      if (m[0].length === 0) continue;
      out.push({ block, start: m.index!, end: m.index! + m[0].length });
    }
  });
  return out;
}

const before = (a: Pos, b: Pos) => a.block < b.block || (a.block === b.block && a.offset < b.offset);

/** Índice da próxima ocorrência a partir de `pos` (dá a volta no fim do documento). */
export function nextMatch(matches: Match[], pos: Pos, backwards = false): number {
  if (matches.length === 0) return -1;
  if (backwards) {
    for (let i = matches.length - 1; i >= 0; i--) {
      if (before({ block: matches[i].block, offset: matches[i].start }, pos)) return i;
    }
    return matches.length - 1;
  }
  const i = matches.findIndex((m) => !before({ block: m.block, offset: m.start }, pos));
  return i === -1 ? 0 : i;
}

export const matchSelection = (m: Match): Selection => ({
  anchor: { block: m.block, offset: m.start },
  focus: { block: m.block, offset: m.end },
});

/** Troca uma ocorrência; o texto novo recebe a formatação do primeiro caractere trocado. */
function replaceOne(doc: DocView, m: Match, replacement: string): TextCommand[] {
  const marks = marksAt(doc, { block: m.block, offset: m.start + 1 });
  const commands: TextCommand[] = [];
  if (replacement) commands.push({ type: "text.insert", block: m.block, offset: m.end, text: replacement, marks });
  commands.push({ type: "text.delete", block: m.block, offset: m.start, len: m.end - m.start });
  return commands;
}

export function replaceMatch(doc: DocView, m: Match, replacement: string): TextCommand {
  return { type: "batch", commands: replaceOne(doc, m, replacement) };
}

/** Substituir tudo num único passo de desfazer. Devolve também quantas trocas. */
export function replaceAll(
  doc: DocView,
  query: string,
  replacement: string,
  opts: FindOptions,
): { command: TextCommand | null; count: number } {
  const matches = findAll(doc, query, opts);
  // Do fim para o começo, para os offsets das anteriores não mudarem.
  const commands = [...matches].reverse().flatMap((m) => replaceOne(doc, m, replacement));
  return { command: commands.length ? { type: "batch", commands } : null, count: matches.length };
}

/** Trecho de contexto para a lista de resultados do painel. */
export function matchContext(doc: DocView, m: Match, radius = 28): { before: string; match: string; after: string } {
  const text = blockText(doc.blocks[m.block]);
  const start = Math.max(0, m.start - radius);
  const end = Math.min(text.length, m.end + radius);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, m.start),
    match: text.slice(m.start, m.end),
    after: text.slice(m.end, end) + (end < text.length ? "…" : ""),
  };
}

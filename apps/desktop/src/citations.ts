// Citações e Bibliografia (Referências; ADR 0013), na ABNT.
//
// Cada fonte fica em `DocView.sources` (no núcleo, `src:<id>` nas
// configurações). A chamada é o caractere CITATION_CHAR com a marca
// `citation {id, page?}`; o texto dela, "(SILVA, 2026, p. 12)", é gerado na
// tela pela regra autor-data (NBR 10520), igual ao `citation_text` do núcleo.
// A bibliografia são parágrafos comuns marcados com `bibliography` (título e
// entradas na NBR 6023), refeitos por Atualizar Bibliografia, como o Sumário.

import { caret, ordered, type Edit, type Selection } from "./model";
import { CITATION_CHAR, type BlockView, type DocView, type Mark, type Person, type Source, type Span, type TextCommand } from "./types";

/** Fonte e página de uma lista de marcas, se for uma chamada. */
export function citationOf(marks: Mark[]): { id: string; page?: string } | null {
  for (const m of marks) if (m.mark === "citation") return { id: m.id, page: m.page };
  return null;
}

export function newSourceId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const upper = (s: string) => s.toLocaleUpperCase("pt-BR");
const names = (s: Source) => (s.authors ?? []).filter((p) => p.last.trim() !== "");

/** Autor da chamada: "SILVA", "SILVA; SOUZA", "SILVA et al." ou, sem autor, "METODOLOGIA...". */
export function citationAuthor(s: Source): string {
  const list = names(s).map((p) => upper(p.last.trim()));
  if (!list.length) {
    const word = (s.title.trim().split(/\s+/)[0] ?? "").replace(/[:,.;]+$/, "");
    return `${upper(word)}...`;
  }
  return list.length <= 3 ? list.join("; ") : `${list[0]} et al.`;
}

/** Texto da chamada autor-data; fonte apagada: "(?)". */
export function citationText(s: Source | undefined, page?: string): string {
  if (!s) return "(?)";
  const year = s.year?.trim() || "[s. d.]";
  const p = page?.trim();
  return `(${citationAuthor(s)}, ${year}${p ? `, p. ${p}` : ""})`;
}

/** Insere a chamada no fim da seleção: um passo de desfazer. */
export function insertCitation(sel: Selection, id: string, page?: string): Edit {
  const [, end] = ordered(sel);
  const mark: Mark = page?.trim() ? { mark: "citation", id, page: page.trim() } : { mark: "citation", id };
  return {
    command: { type: "text.insert", block: end.block, offset: end.offset, text: CITATION_CHAR, marks: [mark] },
    selection: caret({ block: end.block, offset: end.offset + 1 }),
  };
}

/** Fontes citadas no texto (ids). */
export function citedSources(blocks: BlockView[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) for (const s of b.spans) {
    const c = citationOf(s.marks);
    if (c) out.add(c.id);
  }
  return out;
}

/** Autores digitados como "Silva, João; Souza, Maria" (entidade sem vírgula). */
export function parseAuthors(text: string): Person[] {
  return text
    .split(";")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => {
      const i = a.indexOf(",");
      return i < 0 ? { last: a, first: "" } : { last: a.slice(0, i).trim(), first: a.slice(i + 1).trim() };
    });
}

export const formatAuthors = (authors: Person[] | undefined) =>
  (authors ?? []).map((p) => (p.first ? `${p.last}, ${p.first}` : p.last)).join("; ");

// ---------------------------------------------------------------- NBR 6023

const MONTHS = ["jan.", "fev.", "mar.", "abr.", "maio", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

/** "2026-10-30" → "30 out. 2026", como pede a ABNT. */
export function accessDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "SILVA, João" (entidade: "UNIVERSIDADE DE SÃO PAULO"). */
function personRef(p: Person): string {
  const last = upper(p.last.trim());
  return p.first.trim() ? `${last}, ${p.first.trim()}` : last;
}

function authorsRef(s: Source): string {
  const list = names(s);
  if (!list.length) return "";
  return list.length <= 3 ? list.map(personRef).join("; ") : `${personRef(list[0])} et al.`;
}

/** Fecha um elemento com ponto, sem repetir o ponto de uma abreviatura ("et al."). */
const dot = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** Título principal e subtítulo ("Metodologia: um guia" → ["Metodologia", "um guia"]). */
function splitTitle(title: string): [string, string] {
  const i = title.indexOf(": ");
  return i < 0 ? [title.trim(), ""] : [title.slice(0, i).trim(), title.slice(i + 2).trim()];
}

/** Sem autor, a entrada começa pelo título com a primeira palavra em maiúsculas (sem negrito). */
function titleEntry(title: string): string {
  const t = title.trim();
  const i = t.search(/\s/);
  return i < 0 ? upper(t) : `${upper(t.slice(0, i))}${t.slice(i)}`;
}

type Piece = { text: string; bold?: boolean };

/** Entrada da lista de referências (NBR 6023), em trechos com o negrito do destaque. */
export function referencePieces(s: Source): Piece[] {
  const out: Piece[] = [];
  const add = (text: string, bold = false) => text && out.push({ text, bold });
  const authors = authorsRef(s);
  const [main, sub] = splitTitle(s.title);
  const year = s.year?.trim() ?? "";
  const field = (v?: string) => v?.trim() ?? "";
  // Título em destaque (negrito) só quando há autor; o subtítulo nunca.
  const title = (bold: boolean) => {
    if (!authors) {
      add(titleEntry(main));
    } else {
      add(main, bold);
    }
    add(sub ? `: ${sub}. ` : ". ");
  };
  if (authors) add(`${dot(authors)} `);
  switch (s.kind) {
    case "article": {
      if (authors) add(main);
      else add(titleEntry(main));
      add(sub ? `: ${sub}. ` : ". ");
      if (field(s.journal)) {
        add(field(s.journal), true);
        add(", ");
      }
      const parts = [field(s.place), field(s.volume) && `v. ${field(s.volume)}`, field(s.issue) && `n. ${field(s.issue)}`, field(s.pages) && `p. ${field(s.pages)}`, year || "[s. d.]"].filter(Boolean);
      add(`${parts.join(", ")}.`);
      break;
    }
    case "thesis": {
      title(true);
      add(`${year ? `${year}. ` : ""}${field(s.degree) || "Tese"}`);
      const where = [field(s.institution), field(s.place), year].filter(Boolean);
      add(where.length ? ` – ${where.join(", ")}.` : ".");
      break;
    }
    case "web": {
      title(true);
      const where = [field(s.place) && field(s.publisher) ? `${field(s.place)}: ${field(s.publisher)}` : field(s.place) || field(s.publisher), year].filter(Boolean);
      if (where.length) add(`${where.join(", ")}.`);
      break;
    }
    default: {
      title(true);
      const ed = field(s.edition);
      if (ed) add(`${/^\d+$/.test(ed) ? `${ed}. ed.` : dot(ed)} `);
      const place = field(s.place);
      const publisher = field(s.publisher);
      const imprint = !place && !publisher ? "[S. l.: s. n.]" : `${place || "[S. l.]"}: ${publisher || "[s. n.]"}`;
      add(`${imprint}, ${year || "[s. d.]"}.`);
    }
  }
  if (field(s.url)) add(` Disponível em: ${field(s.url)}.`);
  if (field(s.accessed)) add(` Acesso em: ${accessDate(field(s.accessed))}.`);
  // Junta trechos vizinhos com o mesmo destaque e tira espaços sobrando no fim.
  const merged: Piece[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last && !!last.bold === !!p.bold) last.text += p.text;
    else merged.push({ ...p });
  }
  if (merged.length) merged[merged.length - 1].text = merged[merged.length - 1].text.trimEnd();
  return merged;
}

export const referenceText = (s: Source) => referencePieces(s).map((p) => p.text).join("");

/** Fontes em ordem alfabética da entrada (como a lista de referências da ABNT). */
export function sortedSources(sources: Record<string, Source> | undefined): [string, Source][] {
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
  return Object.entries(sources ?? {}).sort(([, a], [, b]) => collator.compare(referenceText(a), referenceText(b)));
}

// ---------------------------------------------------------------- bibliografia

/** Primeira bibliografia do documento: parágrafos seguidos com `bibliography`, [start, end). */
export function findBibliography(blocks: BlockView[]): { start: number; end: number } | null {
  const start = blocks.findIndex((b) => b.attrs.bibliography);
  if (start < 0) return null;
  let end = start + 1;
  while (end < blocks.length && blocks[end].attrs.bibliography) end++;
  return { start, end };
}

export interface BibliographyLabels {
  title: string;
  empty: string;
}

/** Um parágrafo de entrada: espaço simples, uma linha em branco depois (NBR 6023). */
function entryCommands(index: number, pieces: Piece[]): TextCommand[] {
  const commands: TextCommand[] = [{ type: "block.insert", index, text: "", style: "paragraph" }];
  let offset = 0;
  for (const p of pieces) {
    commands.push({ type: "text.insert", block: index, offset, text: p.text, marks: p.bold ? [{ mark: "bold" }] : [] });
    offset += p.text.length;
  }
  commands.push(
    { type: "block.setAttr", block: index, attr: "bibliography", value: "entry" },
    { type: "block.setAttr", block: index, attr: "lineSpacing", value: 100 },
    { type: "block.setAttr", block: index, attr: "spaceAfter", value: 12 },
  );
  return commands;
}

function entries(doc: DocView, index: number, empty: string): { commands: TextCommand[]; count: number } {
  const list = sortedSources(doc.sources);
  if (!list.length) return { commands: entryCommands(index, [{ text: empty }]), count: 1 };
  return { commands: list.flatMap(([, s], k) => entryCommands(index + k, referencePieces(s))), count: list.length };
}

/**
 * Insere a bibliografia no parágrafo do cursor (antes dele, no começo; depois,
 * se não), com o título "REFERÊNCIAS" centralizado como Título 1 (entra no
 * Sumário). Se já há uma, atualiza a existente.
 */
export function insertBibliography(doc: DocView, sel: Selection, labels: BibliographyLabels): Edit {
  if (findBibliography(doc.blocks)) return updateBibliography(doc, sel, labels) ?? { command: null, selection: sel };
  const at = sel.focus.block;
  // Dentro de uma tabela, a bibliografia vai depois dela.
  const table = doc.blocks[at]?.attrs.cell?.table;
  let index = sel.focus.offset === 0 ? at : at + 1;
  if (table) {
    index = at;
    while (index < doc.blocks.length && doc.blocks[index].attrs.cell?.table === table) index++;
  }
  const body = entries(doc, index + 1, labels.empty);
  const commands: TextCommand[] = [
    { type: "block.insert", index, text: labels.title, style: "heading1" },
    { type: "block.setAttr", block: index, attr: "bibliography", value: "title" },
    { type: "block.setAttr", block: index, attr: "align", value: "center" },
    ...body.commands,
  ];
  const inserted = 1 + body.count;
  if (index >= doc.blocks.length) commands.push({ type: "block.insert", index: index + inserted, text: "" });
  return { command: { type: "batch", commands }, selection: caret({ block: index + inserted, offset: 0 }) };
}

/** Atualizar Bibliografia: refaz as entradas com as fontes atuais (o título fica). */
export function updateBibliography(doc: DocView, sel: Selection, labels: BibliographyLabels): Edit | null {
  const range = findBibliography(doc.blocks);
  if (!range) return null;
  const hasTitle = doc.blocks[range.start].attrs.bibliography === "title";
  const first = hasTitle ? range.start + 1 : range.start;
  const commands: TextCommand[] = [];
  for (let b = range.end - 1; b >= first; b--) commands.push({ type: "block.remove", block: b });
  const removed = range.end - first;
  const body = entries(doc, first, labels.empty);
  commands.push(...body.commands);
  // O cursor que estava nas entradas vai para o título; o de depois anda junto com o texto.
  const move = (block: number) => (block < first ? block : block >= range.end ? block - removed + body.count : first);
  const selection = {
    anchor: { ...sel.anchor, block: move(sel.anchor.block) },
    focus: { ...sel.focus, block: move(sel.focus.block) },
  };
  const inside = sel.focus.block >= first && sel.focus.block < range.end;
  return { command: { type: "batch", commands }, selection: inside ? caret({ block: range.start, offset: 0 }) : selection };
}

/** Remove a bibliografia inteira (título e entradas). */
export function removeBibliography(doc: DocView, sel: Selection): Edit | null {
  const range = findBibliography(doc.blocks);
  if (!range) return null;
  const commands: TextCommand[] = [];
  for (let b = range.end - 1; b >= range.start; b--) commands.push({ type: "block.remove", block: b });
  const removed = range.end - range.start;
  if (removed === doc.blocks.length) commands.push({ type: "block.insert", index: 0, text: "" });
  const at = Math.min(range.start, Math.max(0, doc.blocks.length - removed - 1));
  const after = sel.focus.block >= range.end ? sel.focus.block - removed : at;
  return { command: { type: "batch", commands }, selection: caret({ block: Math.max(0, after), offset: 0 }) };
}

/** Trechos de uma entrada como o núcleo guarda (para testes e comparação). */
export function referenceSpans(s: Source): Span[] {
  return referencePieces(s).map((p) => ({ text: p.text, marks: p.bold ? [{ mark: "bold" }] : [] }));
}

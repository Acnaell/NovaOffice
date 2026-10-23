// Estatísticas de "Contar Palavras" (Revisão › Contar Palavras), com as
// mesmas regras do Word: palavras separadas por espaço, caracteres como o
// usuário os vê (um emoji conta um), parágrafos com texto. Páginas e linhas
// dependem do desenho e são medidas na tela (WordCountDialog.tsx).

import { blockText, isCollapsed, ordered, type Selection } from "./model";
import type { DocView } from "./types";

export interface TextStats {
  words: number;
  /** Caracteres sem contar espaços, tabulações e quebras de linha. */
  charsNoSpaces: number;
  /** Caracteres com espaços (tabulações contam; a quebra de parágrafo não). */
  chars: number;
  /** Parágrafos com algum texto, como o Word conta. */
  paragraphs: number;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const graphemes = (text: string) => (segmenter ? [...segmenter.segment(text)].length : Array.from(text).length);

/** Quebra de linha manual (Shift+Enter): separa palavras, mas não é um caractere. */
const LINE_BREAK = /\u000b/g;

export function textStats(paragraphs: string[]): TextStats {
  let words = 0;
  let chars = 0;
  let charsNoSpaces = 0;
  let count = 0;
  for (const raw of paragraphs) {
    const text = raw.replace(LINE_BREAK, " ");
    words += text.match(/\S+/g)?.length ?? 0;
    chars += graphemes(raw.replace(LINE_BREAK, ""));
    charsNoSpaces += graphemes(text.replace(/\s+/g, ""));
    if (text.trim()) count++;
  }
  return { words, chars, charsNoSpaces, paragraphs: count };
}

/** O texto de cada parágrafo dentro da seleção, ou do documento inteiro se ela estiver vazia. */
export function countedTexts(doc: DocView, selection: Selection): string[] {
  const all = doc.blocks.map(blockText);
  if (isCollapsed(selection)) return all;
  const [from, to] = ordered(selection);
  return all.slice(from.block, to.block + 1).map((text, i) => {
    const block = from.block + i;
    return text.slice(block === from.block ? from.offset : 0, block === to.block ? to.offset : undefined);
  });
}

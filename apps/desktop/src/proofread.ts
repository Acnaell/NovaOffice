// Percurso do painel Ortografia (F7): de erro em erro a partir do cursor, como
// no Word, dando a volta no documento. As palavras erradas vêm do corretor
// (spell.ts); aqui só se decide qual é a próxima e o que já foi ignorado.

import type { Match } from "./find";
import { blockText } from "./model";
import type { DocView, Pos } from "./types";

/** "Ignorar uma vez" vale para aquela ocorrência: a palavra naquela posição. */
export const occurrenceKey = (m: Match, word: string) => `${m.block}:${m.start}:${word}`;

export interface Skips {
  /** Ocorrências ignoradas uma vez (`occurrenceKey`). */
  once: ReadonlySet<string>;
  /** Palavras ignoradas ou adicionadas nesta revisão, antes de o corretor responder. */
  words: ReadonlySet<string>;
}

const before = (a: Pos, b: Pos) => a.block < b.block || (a.block === b.block && a.offset < b.offset);

/**
 * O primeiro erro que começa em `from` ou depois; se não houver, o primeiro do
 * documento. `matches` está na ordem do documento, como o corretor devolve.
 */
export function nextError(doc: DocView, matches: Match[], from: Pos, skips: Skips): Match | null {
  const wanted = matches.filter((m) => {
    const word = blockText(doc.blocks[m.block]).slice(m.start, m.end);
    return !skips.words.has(word) && !skips.once.has(occurrenceKey(m, word));
  });
  return wanted.find((m) => !before({ block: m.block, offset: m.start }, from)) ?? wanted[0] ?? null;
}

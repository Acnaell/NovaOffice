// Corretor ortográfico enquanto digita. O núcleo (crate nova-spell) diz quais
// palavras de cada parágrafo estão erradas; aqui decidimos o que verificar de
// novo e o que sublinhar.
//
// O remendo do núcleo mantém os objetos dos parágrafos que não mudaram, então
// o resultado fica guardado por objeto: depois de uma tecla, só o parágrafo
// editado volta ao núcleo.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Match } from "./find";
import { blockText, type Selection } from "./model";
import type { BlockView, DocView, Pos } from "./types";

export const SPELL_LANGUAGES = ["pt-BR", "en-US", "es"] as const;
export type SpellLanguage = (typeof SPELL_LANGUAGES)[number];
/** Idioma de revisão escolhido na barra de status; "off" desliga o corretor. */
export type Proofing = SpellLanguage | "off";

/** Espera depois da última tecla antes de verificar, como o Word. */
const DELAY_MS = 200;
/**
 * Parágrafos por chamada. Ao abrir um documento longo, a primeira verificação
 * vai em partes, sem espera entre elas: os resultados chegam aos poucos e
 * nenhuma chamada ocupa o núcleo por muito tempo enquanto se digita.
 */
const CHUNK = 200;

/** Idioma de revisão inicial: o da interface. */
export function defaultProofing(locale: string): SpellLanguage {
  if (locale.startsWith("en")) return "en-US";
  if (locale.startsWith("es")) return "es";
  return "pt-BR";
}

export function parseProofing(saved: string | null): Proofing | null {
  return saved === "off" || SPELL_LANGUAGES.includes(saved as SpellLanguage) ? (saved as Proofing) : null;
}

/** Intervalos `[início, fim)` em UTF-16, como o núcleo devolve. */
export type Ranges = [number, number][];

/** Resultado de um parágrafo, com o texto verificado (para reaproveitar enquanto o novo não chega). */
interface Checked {
  text: string;
  ranges: Ranges;
}

export class SpellCache {
  private byBlock = new WeakMap<BlockView, Checked>();
  /** Último resultado de cada posição, para não piscar o parágrafo que está sendo editado. */
  private byIndex: Checked[] = [];

  get(block: BlockView): Checked | undefined {
    return this.byBlock.get(block);
  }

  set(block: BlockView, index: number, ranges: Ranges): void {
    const checked = { text: blockText(block), ranges };
    this.byBlock.set(block, checked);
    this.byIndex[index] = checked;
  }

  /** Parágrafos ainda sem resultado, com a posição de cada um. */
  pending(blocks: BlockView[]): { block: BlockView; index: number }[] {
    return blocks.flatMap((block, index) => (this.byBlock.has(block) ? [] : [{ block, index }]));
  }

  /**
   * Todas as palavras erradas conhecidas. Num parágrafo ainda não verificado,
   * reaproveita o resultado anterior da mesma posição onde o texto da palavra
   * não mudou: o que vem antes do ponto editado continua sublinhado.
   */
  matches(blocks: BlockView[]): Match[] {
    const out: Match[] = [];
    blocks.forEach((block, i) => {
      const fresh = this.byBlock.get(block);
      if (fresh) {
        for (const [start, end] of fresh.ranges) out.push({ block: i, start, end });
        return;
      }
      const stale = this.byIndex[i];
      if (!stale) return;
      const text = blockText(block);
      for (const [start, end] of stale.ranges) {
        if (text.slice(start, end) === stale.text.slice(start, end)) out.push({ block: i, start, end });
      }
    });
    return out;
  }
}

/** A palavra que está sendo digitada (cursor logo depois dela) não é sublinhada, como no Word. */
export function hideTyping(matches: Match[], selection: Selection): Match[] {
  const { anchor, focus } = selection;
  if (anchor.block !== focus.block || anchor.offset !== focus.offset) return matches;
  return matches.filter((m) => !(m.block === focus.block && m.end === focus.offset));
}

export function matchAt(matches: Match[], pos: Pos): Match | null {
  return matches.find((m) => m.block === pos.block && m.start <= pos.offset && pos.offset <= m.end) ?? null;
}

export function matchText(doc: DocView, m: Match): string {
  return blockText(doc.blocks[m.block]).slice(m.start, m.end);
}

export interface Spelling {
  /** Palavras erradas para sublinhar. */
  painted: Match[];
  /** Todas as palavras erradas conhecidas (o menu de contexto usa estas). */
  all: Match[];
  /** Esquece os resultados e verifica tudo de novo (depois de adicionar ou ignorar). */
  recheck: () => void;
}

export function useSpelling(view: DocView, selection: Selection, proofing: Proofing): Spelling {
  const cache = useRef(new SpellCache());
  const [version, setVersion] = useState(0);
  const failed = useRef(false);

  const recheck = useCallback(() => {
    cache.current = new SpellCache();
    failed.current = false;
    setVersion((v) => v + 1);
  }, []);

  // Outro idioma: resultados novos.
  useEffect(recheck, [proofing, recheck]);

  useEffect(() => {
    if (proofing === "off" || failed.current) return;
    const current = cache.current;
    const all = current.pending(view.blocks);
    if (all.length === 0) return;
    const pending = all.slice(0, CHUNK);
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .spellCheck(
          proofing,
          pending.map(({ block }) => blockText(block)),
        )
        .then((results) => {
          // Sem núcleo (por exemplo, numa ponte de testes sem corretor), não insiste.
          if (!Array.isArray(results)) {
            failed.current = true;
            return;
          }
          pending.forEach(({ block, index }, i) => current.set(block, index, results[i] ?? []));
          if (!cancelled && current === cache.current) setVersion((v) => v + 1);
        })
        .catch((error) => {
          failed.current = true;
          console.warn("corretor ortográfico indisponível:", error);
        });
    }, all.length > CHUNK ? 0 : DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, proofing, version]);

  const all = useMemo(
    () => (proofing === "off" ? [] : cache.current.matches(view.blocks)),
    // `version` muda quando chegam resultados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, proofing, version],
  );
  const painted = useMemo(() => hideTyping(all, selection), [all, selection]);
  return { painted, all, recheck };
}

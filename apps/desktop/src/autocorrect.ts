// AutoCorreção enquanto digita, como a do Word: maiúscula no início da frase,
// aspas inteligentes, "--" vira travessão e uma lista de substituições. Tudo
// aqui é puro: recebe o texto do parágrafo logo depois de uma tecla e diz o
// que trocar. O App aplica a troca como um passo próprio de desfazer, então
// Ctrl+Z logo depois desfaz só a correção, como no Word.

import { load, store } from "./storage";

export interface AutoCorrectOptions {
  /** Primeira letra da frase em maiúscula. */
  capitalize: boolean;
  /** "aspas" → “aspas” e ' → ’. */
  smartQuotes: boolean;
  /** "--" → "—". */
  dashes: boolean;
  /** Substituir texto enquanto digita, pela lista abaixo. */
  replaceText: boolean;
  replacements: [string, string][];
}

export const DEFAULT_REPLACEMENTS: [string, string][] = [
  ["(c)", "©"],
  ["(r)", "®"],
  ["(tm)", "™"],
  ["...", "…"],
  ["->", "→"],
  ["<-", "←"],
  ["=>", "⇒"],
  ["1/2", "½"],
  ["1/4", "¼"],
  ["3/4", "¾"],
];

export const DEFAULT_AUTOCORRECT: AutoCorrectOptions = {
  capitalize: true,
  smartQuotes: true,
  dashes: true,
  replaceText: true,
  replacements: DEFAULT_REPLACEMENTS,
};

const STORAGE_KEY = "nova.autocorrect";

export function parseAutoCorrect(saved: string | null): AutoCorrectOptions {
  if (!saved) return DEFAULT_AUTOCORRECT;
  try {
    const value = JSON.parse(saved) as Partial<AutoCorrectOptions>;
    const flag = (k: "capitalize" | "smartQuotes" | "dashes" | "replaceText") =>
      typeof value[k] === "boolean" ? (value[k] as boolean) : DEFAULT_AUTOCORRECT[k];
    const replacements = Array.isArray(value.replacements)
      ? value.replacements.filter(
          (r): r is [string, string] => Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string" && r[0] !== "",
        )
      : DEFAULT_REPLACEMENTS;
    return {
      capitalize: flag("capitalize"),
      smartQuotes: flag("smartQuotes"),
      dashes: flag("dashes"),
      replaceText: flag("replaceText"),
      replacements,
    };
  } catch {
    return DEFAULT_AUTOCORRECT;
  }
}

export const loadAutoCorrect = () => parseAutoCorrect(load(STORAGE_KEY));
export const storeAutoCorrect = (options: AutoCorrectOptions) => store(STORAGE_KEY, JSON.stringify(options));

/** Troca no parágrafo: `[start, end)` em UTF-16 vira `text`. */
export interface Correction {
  start: number;
  end: number;
  /** O que estava lá, para conferir antes de trocar (outra tecla pode ter chegado antes). */
  from: string;
  text: string;
}

/** Abreviações comuns depois das quais o ponto não termina a frase. */
const ABBREVIATIONS = new Set([
  "sr", "sra", "srta", "dr", "dra", "prof", "profa", "ex", "etc", "pág", "págs", "p", "pp", "nº", "av", "cap",
  "vol", "fig", "obs", "mr", "mrs", "ms", "st", "vs", "e.g", "i.e", "p.ex", "sto", "sta", "eng", "adm", "art",
]);

const SPACE = /\s/;
/** Teclas que encerram uma palavra e disparam a correção dela. */
const WORD_END = /[\s.,;:!?)\]}"”'’]/;
const OPENS_QUOTE = /[\s([{“‘«—–-]/;

const correction = (text: string, start: number, end: number, replacement: string): Correction | null =>
  text.slice(start, end) === replacement ? null : { start, end, from: text.slice(start, end), text: replacement };

/**
 * O que corrigir depois de digitar `typed`, sendo `text` o parágrafo já com a
 * tecla e `caret` a posição logo depois dela. `wordTyped` diz se a palavra
 * antes da tecla foi digitada agora: um espaço depois de texto que já estava
 * lá não o altera.
 */
export function autoCorrect(
  text: string,
  caret: number,
  typed: string,
  options: AutoCorrectOptions,
  wordTyped = true,
): Correction | null {
  if (typed.length !== 1 || text.slice(caret - 1, caret) !== typed) return null;
  const at = caret - 1;
  const before = text.slice(0, at);

  if (options.smartQuotes && (typed === '"' || typed === "'")) {
    const prev = before.slice(-1);
    const opening = prev === "" || OPENS_QUOTE.test(prev);
    const quote = typed === '"' ? (opening ? "“" : "”") : opening ? "‘" : "’";
    return correction(text, at, caret, quote);
  }

  if (options.dashes && typed !== "-") {
    // "a--b" ao digitar o b; " -- " ao digitar o espaço depois.
    if (/[^\s-]--$/.test(before) && !SPACE.test(typed)) return correction(text, at - 2, at, "—");
    if (/(^|\s)--$/.test(before) && SPACE.test(typed)) return correction(text, at - 2, at, "—");
  }

  if (!wordTyped || !WORD_END.test(typed)) return null;

  if (options.replaceText && SPACE.test(typed)) {
    const token = /\S+$/.exec(before)?.[0];
    // Entradas de símbolos ("...", "->") valem também grudadas na palavra: "Espere...".
    const hit = token
      ? options.replacements.find(([from]) => token === from || (!/^[\p{L}\p{N}]/u.test(from) && token.endsWith(from)))
      : undefined;
    if (token && hit) return correction(text, at - hit[0].length, at, hit[1]);
  }

  // A maiúscula espera o espaço (ou , ; : ! ?) depois da palavra: no ponto
  // ainda pode vir um endereço como "www.site.com".
  if (options.capitalize && typed !== ".") {
    const token = /\S+$/.exec(before)?.[0] ?? "";
    const parts = /^(["“‘'(\[¿¡«]*)(\p{L}[\p{L}\p{M}'’-]*)[.,;:!?…)\]"”’]*$/u.exec(token);
    if (!parts) return null;
    const start = at - token.length + parts[1].length;
    const first = parts[2][0];
    if (first === first.toUpperCase() || first.toLowerCase() !== first) return null;
    if (sentenceStart(text.slice(0, at - token.length))) return correction(text, start, start + 1, first.toUpperCase());
  }
  return null;
}

/** O texto antes da palavra termina uma frase (ou está vazio: início do parágrafo). */
function sentenceStart(before: string): boolean {
  const trimmed = before.trimEnd();
  if (trimmed === "") return true;
  if (trimmed.length === before.length) return false;
  if (!/[.!?…]["”’)]*$/.test(trimmed)) return false;
  if (!trimmed.endsWith(".")) return true;
  const last = (/\S+$/.exec(trimmed)?.[0] ?? "").slice(0, -1).toLowerCase();
  // "Sr. silva", "p. ex.", "1. item": o ponto não fecha a frase.
  return !(ABBREVIATIONS.has(last) || /^\p{L}$/u.test(last) || /^\d+$/.test(last));
}

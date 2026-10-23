// Aviso de atualização: o núcleo (src-tauri/src/update.rs) consulta a última
// release no GitHub; aqui ficam as preferências, quando consultar de novo e as
// notas da release (Markdown) prontas para desenhar.

import { invoke } from "@tauri-apps/api/core";
import { load, store } from "./storage";

export interface Installer {
  name: string;
  url: string;
  size: number;
  checksumUrl: string;
}

/** Versão mais nova que a do app (null do núcleo quando não há). */
export interface UpdateInfo {
  version: string;
  notes: string;
  pageUrl: string;
  installer: Installer | null;
  /** Baixar e instalar pelo app (Windows); senão, abre a página da release. */
  canInstall: boolean;
}

export interface Progress {
  received: number;
  total: number;
}

export const updateApi = {
  check: () => invoke<UpdateInfo | null>("check_update"),
  /** Baixa e confere o instalador da versão encontrada; o progresso vem no evento `update-progress`. */
  download: () => invoke<void>("download_update"),
  /** Roda o instalador em modo passivo e fecha o app. */
  install: () => invoke<void>("install_update"),
};

const NOTIFY_KEY = "nova.update.notify";
const LAST_CHECK_KEY = "nova.update.lastCheck";
export const DAY_MS = 24 * 60 * 60 * 1000;

/** "Avisar sobre atualizações": ligado, a menos que o usuário tenha desligado. */
export const loadNotify = () => load(NOTIFY_KEY) !== "off";
export const storeNotify = (on: boolean) => store(NOTIFY_KEY, on ? "on" : "off");

export const loadLastCheck = () => Number(load(LAST_CHECK_KEY)) || 0;
export const storeLastCheck = (ms: number) => store(LAST_CHECK_KEY, String(ms));

/** Já passou um dia desde a última consulta (ou o relógio voltou). */
export const checkDue = (now: number, last: number) => now - last >= DAY_MS || now < last;

export const percent = ({ received, total }: Progress) =>
  total > 0 ? Math.min(100, Math.floor((received * 100) / total)) : 0;

// ---------- Notas da release (Markdown) ----------

export type Inline =
  | { kind: "text" | "bold" | "italic" | "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type MdBlock =
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)|\*([^*\s][^*]*)\*|(?<!\w)_([^_\s][^_]*)_(?!\w))/g;

/** Negrito, itálico, código e links; o resto é texto (nada vira HTML). */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (item: Inline) => {
    const last = out[out.length - 1];
    if (item.kind === "text" && last?.kind === "text") last.text += item.text;
    else if (item.text) out.push(item);
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    push({ kind: "text", text: text.slice(at, m.index) });
    if (m[2] ?? m[3]) push({ kind: "bold", text: m[2] ?? m[3] });
    else if (m[4]) push({ kind: "code", text: m[4] });
    else if (m[5]) push({ kind: "link", text: m[5], href: m[6] });
    else if (m[7]) push({ kind: "link", text: m[7], href: m[7] });
    else push({ kind: "italic", text: m[8] ?? m[9] });
    at = m.index + m[0].length;
  }
  push({ kind: "text", text: text.slice(at) });
  return out;
}

/** Títulos, listas e parágrafos: o que as notas de release costumam ter. */
export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    const item = /^(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line || /^([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: Math.min(heading[1].length, 3), content: parseInline(heading[2]) });
    } else if (item) {
      flush();
      const ordered = !!item[2];
      const last = blocks[blocks.length - 1];
      const content = parseInline(item[3]);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(content);
      else blocks.push({ kind: "list", ordered, items: [content] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

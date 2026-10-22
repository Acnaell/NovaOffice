// Textos da interface. Cada idioma é um dicionário com as mesmas chaves do
// português (o idioma de referência): o TypeScript recusa um idioma incompleto.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { load, store } from "./storage";

const ptBR = {
  "app.loading": "Carregando…",
  "app.error": "Erro: {error}",

  "tab.file": "Arquivo",
  "tab.home": "Página inicial",
  "tab.view": "Exibir",
  "ribbon.label": "Faixa de opções",
  "ribbon.collapse": "Recolher a faixa de opções",
  "ribbon.expand": "Expandir a faixa de opções",
  "quick.label": "Acesso rápido",

  "group.document": "Documento",
  "group.export": "Exportar",
  "group.history": "Histórico",
  "group.font": "Fonte",
  "group.styles": "Estilos",
  "group.theme": "Tema",
  "group.language": "Idioma",

  "cmd.file.new": "Novo",
  "cmd.file.open": "Abrir",
  "cmd.file.save": "Salvar",
  "cmd.file.saveAs": "Salvar como",
  "cmd.file.exportMarkdown": "Markdown",
  "cmd.file.exportMarkdown.title": "Exportar para Markdown",
  "cmd.edit.undo": "Desfazer",
  "cmd.edit.redo": "Refazer",
  "cmd.format.bold": "Negrito",
  "cmd.format.italic": "Itálico",
  "cmd.format.underline": "Sublinhado",
  "cmd.format.strike": "Tachado",
  "cmd.style.more": "Mais estilos",

  // Letras dos botões de marca, como no Word em cada idioma.
  "mark.bold.letter": "N",
  "mark.italic.letter": "I",
  "mark.underline.letter": "S",
  "mark.strike.letter": "T",

  "style.paragraph": "Texto normal",
  "style.heading1": "Título 1",
  "style.heading2": "Título 2",
  "style.heading3": "Título 3",
  "style.heading4": "Título 4",
  "style.heading5": "Título 5",
  "style.heading6": "Título 6",
  "style.quote": "Citação",
  "style.code": "Código",

  "theme.light": "Claro",
  "theme.dark": "Escuro",
  "theme.system": "Sistema",

  "status.words": "{words} palavras · {blocks} parágrafos",
  "status.unsaved": "Alterações não salvas",
  "status.saved": "Salvo",
  "status.savedTo": "Salvo em {path}",
  "status.exportedTo": "Exportado para {path}",

  "dialog.discard": "O documento tem alterações não salvas. Descartar?",
  "filter.nova": "Documento NovaOffice",
  "filter.text": "Texto",
  "editor.label": "Documento",
};

export type MessageKey = keyof typeof ptBR;
type Messages = Record<MessageKey, string>;

const en: Messages = {
  "app.loading": "Loading…",
  "app.error": "Error: {error}",

  "tab.file": "File",
  "tab.home": "Home",
  "tab.view": "View",
  "ribbon.label": "Ribbon",
  "ribbon.collapse": "Collapse the ribbon",
  "ribbon.expand": "Expand the ribbon",
  "quick.label": "Quick access",

  "group.document": "Document",
  "group.export": "Export",
  "group.history": "History",
  "group.font": "Font",
  "group.styles": "Styles",
  "group.theme": "Theme",
  "group.language": "Language",

  "cmd.file.new": "New",
  "cmd.file.open": "Open",
  "cmd.file.save": "Save",
  "cmd.file.saveAs": "Save as",
  "cmd.file.exportMarkdown": "Markdown",
  "cmd.file.exportMarkdown.title": "Export to Markdown",
  "cmd.edit.undo": "Undo",
  "cmd.edit.redo": "Redo",
  "cmd.format.bold": "Bold",
  "cmd.format.italic": "Italic",
  "cmd.format.underline": "Underline",
  "cmd.format.strike": "Strikethrough",
  "cmd.style.more": "More styles",

  "mark.bold.letter": "B",
  "mark.italic.letter": "I",
  "mark.underline.letter": "U",
  "mark.strike.letter": "S",

  "style.paragraph": "Normal text",
  "style.heading1": "Heading 1",
  "style.heading2": "Heading 2",
  "style.heading3": "Heading 3",
  "style.heading4": "Heading 4",
  "style.heading5": "Heading 5",
  "style.heading6": "Heading 6",
  "style.quote": "Quote",
  "style.code": "Code",

  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",

  "status.words": "{words} words · {blocks} paragraphs",
  "status.unsaved": "Unsaved changes",
  "status.saved": "Saved",
  "status.savedTo": "Saved to {path}",
  "status.exportedTo": "Exported to {path}",

  "dialog.discard": "The document has unsaved changes. Discard them?",
  "filter.nova": "NovaOffice document",
  "filter.text": "Text",
  "editor.label": "Document",
};

export const LOCALES = {
  "pt-BR": { name: "Português (Brasil)", messages: ptBR },
  en: { name: "English", messages: en },
} satisfies Record<string, { name: string; messages: Messages }>;

export type Locale = keyof typeof LOCALES;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Troca `{nome}` pelos parâmetros; chaves sem parâmetro ficam como estão. */
export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export function translator(locale: Locale): Translate {
  const messages: Messages = LOCALES[locale].messages;
  return (key, params) => format(messages[key], params);
}

/** Idioma salvo, ou o do sistema quando houver tradução, ou português. */
export function initialLocale(saved: string | null, system: readonly string[]): Locale {
  const isLocale = (tag: string): tag is Locale => tag in LOCALES;
  if (saved && isLocale(saved)) return saved;
  for (const tag of system) {
    if (isLocale(tag)) return tag;
    const base = tag.split("-")[0];
    const match = (Object.keys(LOCALES) as Locale[]).find((l) => l.split("-")[0] === base);
    if (match) return match;
  }
  return "pt-BR";
}

const STORAGE_KEY = "nova.locale";

interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    initialLocale(load(STORAGE_KEY), navigator.languages),
  );
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    store(STORAGE_KEY, next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale, t: translator(locale) }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n fora do I18nProvider");
  return value;
}

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

  "group.clipboard": "Área de Transferência",
  "group.paragraph": "Parágrafo",
  "group.editing": "Editando",
  "cmd.edit.cut": "Recortar",
  "cmd.edit.copy": "Copiar",
  "cmd.edit.paste": "Colar",
  "cmd.edit.pasteText": "Manter Somente Texto",
  "cmd.edit.pasteKeep": "Manter Formatação Original",
  "cmd.edit.selectAll": "Selecionar Tudo",
  "cmd.edit.select": "Selecionar",
  "cmd.edit.find": "Localizar",
  "cmd.edit.replace": "Substituir",
  "cmd.format.subscript": "Subscrito",
  "cmd.format.superscript": "Sobrescrito",
  "cmd.format.clear": "Limpar Toda a Formatação",
  "cmd.format.grow": "Aumentar Tamanho da Fonte",
  "cmd.format.shrink": "Diminuir Tamanho da Fonte",
  "cmd.format.case": "Maiúsculas e Minúsculas",
  "cmd.format.painter": "Pincel de Formatação",
  "cmd.format.copyFormat": "Copiar Formatação",
  "cmd.format.pasteFormat": "Colar Formatação",
  "cmd.para.alignLeft": "Alinhar à Esquerda",
  "cmd.para.alignCenter": "Centralizar",
  "cmd.para.alignRight": "Alinhar à Direita",
  "cmd.para.justify": "Justificar",
  "cmd.para.bullets": "Marcadores",
  "cmd.para.numbering": "Numeração",
  "cmd.para.indent": "Aumentar Recuo",
  "cmd.para.outdent": "Diminuir Recuo",
  "cmd.para.spacing1": "Espaçamento 1,0",
  "cmd.para.spacing15": "Espaçamento 1,5",
  "cmd.para.spacing2": "Espaçamento 2,0",
  "cmd.para.showMarks": "Mostrar Tudo",
  "cmd.para.spacing": "Espaçamento de Linha e Parágrafo",
  "spacing.addBefore": "Adicionar Espaço Antes do Parágrafo",
  "spacing.removeBefore": "Remover Espaço Antes do Parágrafo",
  "spacing.addAfter": "Adicionar Espaço Depois do Parágrafo",
  "spacing.removeAfter": "Remover Espaço Depois do Parágrafo",
  "font.family": "Fonte",
  "font.size": "Tamanho da Fonte",
  "font.themeFonts": "Fontes do Tema",
  "font.allFonts": "Todas as Fontes",
  "font.headings": "(Títulos)",
  "font.body": "(Corpo)",
  "color.font": "Cor da Fonte",
  "color.highlight": "Cor do Realce de Texto",
  "color.auto": "Automático",
  "color.none": "Sem Cor",
  "color.theme": "Cores do Tema",
  "color.standard": "Cores Padrão",
  "color.more": "Mais Cores…",
  "case.sentence": "Primeira letra da frase em maiúscula.",
  "case.lower": "minúscula",
  "case.upper": "MAIÚSCULAS",
  "case.title": "Colocar Cada Palavra em Maiúscula",
  "case.toggle": "aLTERNAR mAIÚSC./mINÚSC.",
  "hl.yellow": "Amarelo",
  "hl.green": "Verde Brilhante",
  "hl.cyan": "Turquesa",
  "hl.magenta": "Rosa",
  "hl.blue": "Azul",
  "hl.red": "Vermelho",
  "hl.darkBlue": "Azul-escuro",
  "hl.darkCyan": "Azul-petróleo",
  "hl.darkGreen": "Verde",
  "hl.darkMagenta": "Violeta",
  "hl.darkRed": "Vermelho-escuro",
  "hl.darkYellow": "Amarelo-escuro",
  "hl.darkGray": "Cinza 50%",
  "hl.lightGray": "Cinza 25%",
  "hl.black": "Preto",
  "find.title": "Navegação",
  "find.placeholder": "Pesquisar no documento",
  "find.replaceWith": "Substituir por",
  "find.matchCase": "Diferenciar maiúsculas e minúsculas",
  "find.wholeWord": "Somente palavras inteiras",
  "find.next": "Próximo resultado",
  "find.prev": "Resultado anterior",
  "find.replaceOne": "Substituir",
  "find.replaceAll": "Substituir Tudo",
  "find.count": "Resultado {current} de {count}",
  "find.countNone": "{count} resultados",
  "find.none": "Nenhum resultado",
  "find.replaced": "Concluído. {count} substituições feitas.",
  "find.close": "Fechar o painel",
  "status.word": "1 palavra",
  "status.paragraph": "1 parágrafo",
  "status.paragraphs": "{blocks} parágrafos",
  "status.painter": "Pincel de Formatação: selecione o texto que vai receber a formatação (Esc cancela)",
  "status.painterSticky": "Pincel de Formatação fixo: selecione trechos para formatar (Esc encerra)",
  "status.clipboardDenied": "Não foi possível ler a área de transferência; use Ctrl+V.",

  "theme.light": "Claro",
  "theme.dark": "Escuro",
  "theme.system": "Sistema",

  "status.words": "{words} palavras",
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

  "group.clipboard": "Clipboard",
  "group.paragraph": "Paragraph",
  "group.editing": "Editing",
  "cmd.edit.cut": "Cut",
  "cmd.edit.copy": "Copy",
  "cmd.edit.paste": "Paste",
  "cmd.edit.pasteText": "Keep Text Only",
  "cmd.edit.pasteKeep": "Keep Source Formatting",
  "cmd.edit.selectAll": "Select All",
  "cmd.edit.select": "Select",
  "cmd.edit.find": "Find",
  "cmd.edit.replace": "Replace",
  "cmd.format.subscript": "Subscript",
  "cmd.format.superscript": "Superscript",
  "cmd.format.clear": "Clear All Formatting",
  "cmd.format.grow": "Increase Font Size",
  "cmd.format.shrink": "Decrease Font Size",
  "cmd.format.case": "Change Case",
  "cmd.format.painter": "Format Painter",
  "cmd.format.copyFormat": "Copy Formatting",
  "cmd.format.pasteFormat": "Paste Formatting",
  "cmd.para.alignLeft": "Align Left",
  "cmd.para.alignCenter": "Center",
  "cmd.para.alignRight": "Align Right",
  "cmd.para.justify": "Justify",
  "cmd.para.bullets": "Bullets",
  "cmd.para.numbering": "Numbering",
  "cmd.para.indent": "Increase Indent",
  "cmd.para.outdent": "Decrease Indent",
  "cmd.para.spacing1": "Line spacing 1.0",
  "cmd.para.spacing15": "Line spacing 1.5",
  "cmd.para.spacing2": "Line spacing 2.0",
  "cmd.para.showMarks": "Show/Hide",
  "cmd.para.spacing": "Line and Paragraph Spacing",
  "spacing.addBefore": "Add Space Before Paragraph",
  "spacing.removeBefore": "Remove Space Before Paragraph",
  "spacing.addAfter": "Add Space After Paragraph",
  "spacing.removeAfter": "Remove Space After Paragraph",
  "font.family": "Font",
  "font.size": "Font Size",
  "font.themeFonts": "Theme Fonts",
  "font.allFonts": "All Fonts",
  "font.headings": "(Headings)",
  "font.body": "(Body)",
  "color.font": "Font Color",
  "color.highlight": "Text Highlight Color",
  "color.auto": "Automatic",
  "color.none": "No Color",
  "color.theme": "Theme Colors",
  "color.standard": "Standard Colors",
  "color.more": "More Colors…",
  "case.sentence": "Sentence case.",
  "case.lower": "lowercase",
  "case.upper": "UPPERCASE",
  "case.title": "Capitalize Each Word",
  "case.toggle": "tOGGLE cASE",
  "hl.yellow": "Yellow",
  "hl.green": "Bright Green",
  "hl.cyan": "Turquoise",
  "hl.magenta": "Pink",
  "hl.blue": "Blue",
  "hl.red": "Red",
  "hl.darkBlue": "Dark Blue",
  "hl.darkCyan": "Teal",
  "hl.darkGreen": "Green",
  "hl.darkMagenta": "Violet",
  "hl.darkRed": "Dark Red",
  "hl.darkYellow": "Dark Yellow",
  "hl.darkGray": "Gray 50%",
  "hl.lightGray": "Gray 25%",
  "hl.black": "Black",
  "find.title": "Navigation",
  "find.placeholder": "Search document",
  "find.replaceWith": "Replace with",
  "find.matchCase": "Match case",
  "find.wholeWord": "Find whole words only",
  "find.next": "Next result",
  "find.prev": "Previous result",
  "find.replaceOne": "Replace",
  "find.replaceAll": "Replace All",
  "find.count": "Result {current} of {count}",
  "find.countNone": "{count} results",
  "find.none": "No results",
  "find.replaced": "All done. {count} replacements made.",
  "find.close": "Close the pane",
  "status.word": "1 word",
  "status.paragraph": "1 paragraph",
  "status.paragraphs": "{blocks} paragraphs",
  "status.painter": "Format Painter: select the text to format (Esc cancels)",
  "status.painterSticky": "Format Painter locked: select text to format (Esc ends)",
  "status.clipboardDenied": "Couldn't read the clipboard; use Ctrl+V.",

  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",

  "status.words": "{words} words",
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

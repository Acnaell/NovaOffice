// Área de edição. O `contenteditable` dá cursor, seleção com mouse e IME
// nativos, mas nenhuma digitação altera o DOM: cada `beforeinput` é cancelado
// e vira um comando para o núcleo, que devolve o documento para redesenhar.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { api } from "./api";
import { cachedMediaUrl, mediaUrl, resizeImage, setImage } from "./images";
import { fragmentHtml, fragmentOf, fragmentText, HIGHLIGHT_CSS, insertFragment, NOVA_MIME, parseHtml, plainFragment, type Fragment } from "./clipboard";
import { posFromDom, posToDom, readSelection, writeSelection } from "./dom";
import type { Match } from "./find";
import { autoLink, autoList, changeIndent, isDark, linkOf, listMarkers } from "./formatting";
import { moveToCell, tableGrid } from "./tables";
import { paginate, unpaginate, type PageInfo } from "./paginate";
import { screenPages, tocTargets } from "./toc";
import { footnoteOf, footnoteOrder, FootnotesLayer, FootnotesPrint, NOTE_SEPARATOR, noteHeight, notesByPage, type PageNotes } from "./footnotes";
import { HeaderFooterLayer, splitFields, type Part } from "./headerfooter";
import { paperStyle, printDesignCss, printMarginBoxes } from "./design";
import { PrintDesign, SheetDesign } from "./pagedesign";
import {
  blockText,
  deleteBackward,
  deleteForward,
  deleteToBlockEdge,
  deleteWordBackward,
  deleteWordForward,
  insertText,
  isCollapsed,
  marksAt,
  ordered,
  deleteRange,
  splitBlock,
  type Edit,
  type Selection,
} from "./model";
import { useI18n } from "./i18n";
import { matchShortcut, type CommandId, type Profile } from "./shortcuts";
import type { BlockView, DocView, HeaderFooter, HeadersFooters, ImageRef, Mark, ParaAttrs, Pos } from "./types";

export type EditFn = (doc: DocView, sel: Selection) => Edit | null;

interface Props {
  view: DocView;
  revision: number;
  selection: Selection;
  /** Marcas escolhidas com o cursor parado, para o próximo texto digitado. */
  pendingMarks: Mark[] | null;
  profile: Profile;
  /** Mostrar ¶, espaços (·) e tabulações (→), como o botão Mostrar Tudo do Word. */
  showMarks: boolean;
  /** Ocorrências da pesquisa para destacar; `current` em outra cor. */
  highlights: { all: Match[]; current: Match | null };
  /** Palavras erradas, sublinhadas em vermelho ondulado. */
  misspelled: Match[];
  /** Clique direito no texto; `true` se o app mostrou o próprio menu. */
  onContextMenu: (pos: Pos, x: number, y: number) => boolean;
  onEdit: (fn: EditFn) => void;
  onSelect: (sel: Selection) => void;
  /** Comandos de edição e formatação (atalhos e menu nativo); os de arquivo ficam com a janela. */
  onCommand: (command: CommandId) => void;
  /** Botão do mouse solto no texto (o Pincel de Formatação aplica aqui). */
  onPointerUp: () => void;
  onEscape: () => void;
  /** Ctrl+clique num link. */
  onOpenLink: (href: string) => void;
  /** Imagem colada da área de transferência. */
  onPasteImage: (file: File) => void;
  /** Página do cursor e total de páginas, para a barra de status. */
  onPageInfo: (info: PageInfo) => void;
  /** Cabeçalho e rodapé mostrados (o rascunho, durante a edição). */
  headerFooter: HeadersFooters;
  hfEditing: { part: Part; page: number } | null;
  onHfEdit: (part: Part, page: number) => void;
  onHfChange: (part: Part, value: HeaderFooter) => void;
  onHfClose: () => void;
  /** Nota de rodapé recém-inserida, que recebe o cursor. */
  footnoteFocus: string | null;
  onFootnoteFocused: () => void;
  onFootnoteChange: (id: string, text: string) => void;
  onFootnoteDone: () => void;
}

/** Distância do cabeçalho e do rodapé à borda do papel: 1,25 cm (708 twips), o padrão do Word. */
const HEADER_DISTANCE = 708;

/**
 * Cabeçalho e rodapé na impressão: caixas de margem do @page (Chromium/WebView2),
 * com os contadores de página do CSS no lugar dos campos.
 */
function printBoxes(hf: HeadersFooters, blank = false): string {
  const box = (part: "top" | "bottom", value: HeaderFooter) => {
    const where = value.align === "center" ? "center" : value.align === "right" ? "right" : "left";
    const content = blank
      ? "none"
      : splitFields(value.text)
          .map((p) => (p.field === "{PAGE}" ? "counter(page)" : p.field ? "counter(pages)" : cssString(p.text!)))
          .join(" ") || "none";
    return `@${part}-${where} { content: ${content}; white-space: pre-wrap; font: 11pt Calibri, Carlito, sans-serif; vertical-align: ${part === "top" ? "bottom" : "top"}; }`;
  };
  return `${hf.header.text ? box("top", hf.header) : ""} ${hf.footer.text ? box("bottom", hf.footer) : ""}`;
}

/** Texto como string do CSS: aspas e barras escapadas, quebra de linha como \A. */
const cssString = (text: string) => `"${text.replace(/[\\"]/g, (c) => `\\${c}`).replace(/\u000B/g, "\\A ")}"`;

/** Intervalo entre as folhas na tela, em px. */
const SHEET_GAP = 24;

/** twips (1/1440 pol.) → px de CSS (1/96 pol.). */
const px = (twips: number) => twips / 15;

/** Quebra de linha manual (Shift+Enter), como no Word. */
const LINE_BREAK = "\u000B";

/** Recuo por nível, como o Word (1,27 cm = 0,5 pol). */
const INDENT_STEP = "1.27cm";

export function Editor(props: Props) {
  const { t } = useI18n();
  const page = props.view.page;
  const [pages, setPages] = useState(1);
  const [notePages, setNotePages] = useState<PageNotes[]>([]);
  // Objeto estável: os parágrafos memorizados só redesenham quando mudam.
  const labels = useMemo(() => ({ pageBreak: t("insert.pageBreakMark"), followLink: t("insert.followLink") }), [t]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Os listeners nativos são registrados uma vez; leem as props mais recentes daqui.
  const latest = useRef(props);
  latest.current = props;

  // Depois de cada redesenho, recoloca o cursor onde o modelo diz. Só quando
  // o documento muda: mudanças de seleção vindas do próprio DOM (mouse, setas)
  // não precisam ser escritas de volta.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root && document.activeElement === root) writeSelection(root, latest.current.selection);
  }, [props.revision, props.showMarks]);

  // Páginas: depois de cada desenho, empurra para a página seguinte o que não cabe.
  const repaginate = useRef(() => {});
  repaginate.current = () => {
    const root = rootRef.current;
    if (!root) return;
    // Notas de rodapé: número de cada chamada antes de medir (o número ocupa espaço na linha).
    const order = footnoteOrder(latest.current.view.blocks);
    const refs = root.querySelectorAll<HTMLElement>(".fn-ref");
    refs.forEach((el) => {
      const n = String(order.indexOf(el.dataset.fn ?? "") + 1 || "");
      if (el.dataset.n !== n) el.dataset.n = n;
    });
    const texts = latest.current.view.footnotes;
    const width = px(page.width - page.marginLeft - page.marginRight);
    const notesOf = refs.length
      ? (unit: HTMLElement) => {
          let h = 0;
          unit.querySelectorAll<HTMLElement>(".fn-ref").forEach((el) => (h += noteHeight(texts[el.dataset.fn ?? ""] ?? "", width)));
          return h;
        }
      : undefined;
    const info = paginate(
      root,
      { pageHeight: px(page.height), gap: SHEET_GAP, marginTop: px(page.marginTop), marginBottom: px(page.marginBottom) },
      latest.current.selection.focus.block,
      notesOf,
      NOTE_SEPARATOR,
    );
    setPages((n) => (n === info.pages ? n : info.pages));
    const byPage = refs.length ? notesByPage(root, order) : [];
    setNotePages((old) => (JSON.stringify(old) === JSON.stringify(byPage) ? old : byPage));
    // Sumário: o número da página de cada entrada é o da página real do título.
    const entries = root.querySelectorAll<HTMLElement>(".toc-entry");
    if (entries.length) {
      const targets = tocTargets(latest.current.view.blocks);
      const pageOf = screenPages(root);
      entries.forEach((el) => {
        const target = targets.get(Number(el.dataset.block));
        const page = target === undefined ? "" : String(pageOf(target));
        if (el.dataset.page !== page) el.dataset.page = page;
      });
    }
    latest.current.onPageInfo(info);
  };
  useLayoutEffect(() => repaginate.current(), [props.revision, props.showMarks, props.selection.focus.block, page]);
  useEffect(() => {
    // Fontes carregadas depois mudam a altura das linhas; na impressão, o navegador pagina sozinho.
    document.fonts?.ready.then(() => repaginate.current());
    const before = () => rootRef.current && unpaginate(rootRef.current);
    const after = () => repaginate.current();
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  // Impressão e PDF com o papel e as margens do documento.
  useEffect(() => {
    let style = document.getElementById("page-print") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "page-print";
      document.head.appendChild(style);
    }
    const pt = (twips: number) => `${twips / 20}pt`;
    // Cor e borda da página (aba Design) nas caixas de margem, antes das do cabeçalho e rodapé.
    const design = printMarginBoxes(page);
    style.textContent = `@page { size: ${pt(page.width)} ${pt(page.height)}; margin: ${pt(page.marginTop)} ${pt(page.marginRight)} ${pt(page.marginBottom)} ${pt(page.marginLeft)}; ${design} ${printBoxes(props.headerFooter)} }${
      props.headerFooter.differentFirst ? ` @page :first { ${printBoxes(props.headerFooter, true)} ${design} }` : ""
    }${printDesignCss(page, props.view.watermark)}`;
  }, [page, props.headerFooter, props.view.watermark]);

  // Imagem com o cursor no parágrafo dela: contorno e alça de tamanho.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll(".embedded-image.selected").forEach((el) => el.classList.remove("selected"));
    const block = props.view.blocks[props.selection.focus.block];
    if (block?.attrs.image) {
      root.querySelector(`[data-block="${props.selection.focus.block}"] .embedded-image`)?.classList.add("selected");
    }
  }, [props.revision, props.selection, props.view]);

  // Destaque das ocorrências da pesquisa, sem tocar no DOM do texto.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!root || !registry || !HighlightCtor) return;
    const toRange = (m: Match) => matchRange(root, m);
    const all = props.highlights.all.map(toRange).filter((r): r is Range => !!r);
    registry.set("nova-find", new HighlightCtor(...all));
    const current = props.highlights.current && toRange(props.highlights.current);
    registry.set("nova-find-current", new HighlightCtor(...(current ? [current] : [])));
    if (props.highlights.current) {
      root.querySelector(`[data-block="${props.highlights.current.block}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }, [props.revision, props.highlights]);

  // Sublinhado do corretor ortográfico, pelo mesmo mecanismo.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!root || !registry || !HighlightCtor) return;
    const ranges = props.misspelled.map((m) => matchRange(root, m)).filter((r): r is Range => !!r);
    registry.set("nova-spell", new HighlightCtor(...ranges));
  }, [props.revision, props.misspelled, props.showMarks]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    writeSelection(root, latest.current.selection);

    const edit = (fn: EditFn) => latest.current.onEdit(fn);
    /** AutoFormatação: um endereço logo antes do cursor vira link ao digitar espaço ou Enter. */
    const withAutoLink = (fn: EditFn): EditFn => (doc, sel) => {
      const link = autoLink(doc, sel);
      const result = fn(doc, sel);
      if (!link || !result) return result;
      const rest = result.command ? (result.command.type === "batch" ? result.command.commands : [result.command]) : [];
      return { ...result, command: { type: "batch", commands: [link, ...rest] } };
    };

    const typed = (text: string): EditFn => (doc, sel) =>
      // AutoFormatação: "- " ou "1. " no início do parágrafo vira lista.
      (() => {
        const list = autoList(doc, sel, text);
        return list ? { command: list, selection: { anchor: { block: sel.focus.block, offset: 0 }, focus: { block: sel.focus.block, offset: 0 } } } : null;
      })() ??
      (/^\s$/.test(text) ? withAutoLink((d, s) => insertText(d, s, text, latest.current.pendingMarks ?? undefined))(doc, sel) : null) ??
      insertText(doc, sel, text, latest.current.pendingMarks ?? undefined);

    const paste = (fragment: Fragment) => edit((doc, sel) => insertFragment(doc, sel, fragment));

    const onBeforeInput = (e: InputEvent) => {
      // Durante a composição (acentos com tecla morta, IME) o navegador escreve
      // no DOM; o texto final chega em compositionend.
      if (e.isComposing || e.inputType === "insertCompositionText") return;
      e.preventDefault();
      switch (e.inputType) {
        case "insertText":
        case "insertReplacementText":
        case "insertFromYank": {
          const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
          if (text) edit(typed(text));
          break;
        }
        case "insertFromPaste": {
          // Normalmente o evento paste já cuidou; isto cobre colagens sem ele.
          const text = e.dataTransfer?.getData("text/plain") ?? "";
          if (text) edit(typed(text));
          break;
        }
        case "insertParagraph":
          edit(withAutoLink(splitBlock));
          break;
        case "insertLineBreak":
          // Shift+Enter: quebra de linha dentro do parágrafo (o mesmo caractere do Word, U+000B).
          edit((doc, sel) => insertText(doc, sel, LINE_BREAK, latest.current.pendingMarks ?? undefined));
          break;
        case "deleteContentBackward":
          edit(deleteBackward);
          break;
        case "deleteContentForward":
          edit(deleteForward);
          break;
        case "deleteWordBackward":
          edit(deleteWordBackward);
          break;
        case "deleteWordForward":
          edit(deleteWordForward);
          break;
        case "deleteSoftLineBackward":
        case "deleteHardLineBackward":
          edit((doc, sel) => deleteToBlockEdge(doc, sel, true));
          break;
        case "deleteSoftLineForward":
        case "deleteHardLineForward":
          edit((doc, sel) => deleteToBlockEdge(doc, sel, false));
          break;
        case "deleteByCut":
        case "deleteContent":
          edit((doc, sel) => (isCollapsed(sel) ? null : deleteRange(...ordered(sel), doc)));
          break;
        case "historyUndo":
          latest.current.onCommand("edit.undo");
          break;
        case "historyRedo":
          latest.current.onCommand("edit.redo");
          break;
        case "formatBold":
          latest.current.onCommand("format.bold");
          break;
        case "formatItalic":
          latest.current.onCommand("format.italic");
          break;
        case "formatUnderline":
          latest.current.onCommand("format.underline");
          break;
        case "formatStrikeThrough":
          latest.current.onCommand("format.strike");
          break;
        default:
          // Demais tipos (arrastar e soltar, formatação do navegador) são ignorados.
          break;
      }
    };

    // Durante a composição (tecla morta do ABNT2, IME) o navegador escreve um
    // texto provisório no DOM e move o cursor dentro dele. Essas posições não
    // existem no modelo: a seleção fica congelada desde o início da composição.
    let composingFrom: Selection | null = null;

    const onCompositionStart = () => {
      composingFrom = latest.current.selection;
    };

    const onCompositionEnd = (e: CompositionEvent) => {
      // Mesmo sem texto, o edit força um redesenho que descarta o que o IME escreveu no DOM.
      const text = e.data;
      const from = composingFrom;
      composingFrom = null;
      edit((doc, sel) => {
        const at = from ?? sel;
        return text ? insertText(doc, at, text, latest.current.pendingMarks ?? undefined) : { command: null, selection: at };
      });
    };

    const onSelectionChange = () => {
      if (composingFrom) return;
      const sel = readSelection(root);
      if (sel) latest.current.onSelect(sel);
    };

    /** Copiar e recortar: formato do Nova, HTML e texto, a partir do modelo (não do DOM). */
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      const { view, selection } = latest.current;
      if (isCollapsed(selection) || !e.clipboardData) return;
      e.preventDefault();
      const fragment = fragmentOf(view, selection);
      e.clipboardData.setData("text/plain", fragmentText(fragment));
      e.clipboardData.setData("text/html", fragmentHtml(fragment));
      e.clipboardData.setData(NOVA_MIME, JSON.stringify(fragment));
      if (cut) edit((doc, sel) => deleteRange(...ordered(sel), doc));
    };

    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data) return;
      e.preventDefault();
      // Imagem copiada (captura de tela, imagem do navegador): vira imagem no documento.
      // Quem copia texto do Word também leva uma imagem do trecho; aí vale o texto.
      const picture = Array.from(data.files).find((f) => f.type.startsWith("image/"));
      if (picture && !data.getData(NOVA_MIME) && !data.getData("text/plain").trim()) {
        latest.current.onPasteImage(picture);
        return;
      }
      const nova = data.getData(NOVA_MIME);
      if (nova) {
        try {
          return paste(JSON.parse(nova) as Fragment);
        } catch {
          // Conteúdo inválido: cai para HTML ou texto.
        }
      }
      const html = data.getData("text/html");
      if (html) {
        const fragment = parseHtml(html);
        if (fragment.length) return paste(fragment);
      }
      const text = data.getData("text/plain");
      if (text) {
        edit((doc, sel) =>
          insertFragment(doc, sel, plainFragment(text, latest.current.pendingMarks ?? marksAt(doc, ordered(sel)[0]))),
        );
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const command = matchShortcut(e, latest.current.profile);
      // Atalhos de arquivo sobem até a janela, que cuida deles.
      if (command && !command.startsWith("file.")) {
        handled();
        latest.current.onCommand(command);
        return;
      }
      if (e.key === "Escape") {
        latest.current.onEscape();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        // Ctrl+↓ vai ao início do próximo parágrafo; Ctrl+↑ ao início deste ou do anterior.
        handled();
        const down = e.key === "ArrowDown";
        edit((doc, sel) => {
          const { block, offset } = sel.focus;
          const last = doc.blocks.length - 1;
          const target = down
            ? block < last
              ? { block: block + 1, offset: 0 }
              : { block, offset: blockText(doc.blocks[block]).length }
            : offset > 0
              ? { block, offset: 0 }
              : { block: Math.max(0, block - 1), offset: 0 };
          return { command: null, selection: { anchor: e.shiftKey ? sel.anchor : target, focus: target } };
        });
        return;
      }
      if (e.key === "Tab" && !(e.ctrlKey || e.metaKey) && !e.altKey) {
        handled();
        const { view, selection } = latest.current;
        // Na tabela, Tab vai para a próxima célula (e cria uma linha na última).
        if (view.blocks[selection.focus.block]?.attrs.cell) {
          edit((doc, sel) => moveToCell(doc, sel, e.shiftKey));
          return;
        }
        const [from, to] = ordered(selection);
        const inList = !!view.blocks[from.block]?.attrs.list;
        // Como no Word: Tab no início de um item de lista (ou com vários parágrafos
        // selecionados) muda o nível; Shift+Tab num item volta um nível.
        if ((inList && (from.offset === 0 || e.shiftKey)) || from.block !== to.block) {
          edit((doc, sel) => ({ command: changeIndent(doc, sel, e.shiftKey ? -1 : 1), selection: sel }));
        } else if (!e.shiftKey) {
          edit(typed("\t"));
        }
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      const pos = posFromPoint(root, e.clientX, e.clientY);
      if (pos && latest.current.onContextMenu(pos, e.clientX, e.clientY)) e.preventDefault();
    };

    const block = (e: Event) => e.preventDefault();
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    // Clique na imagem põe o cursor no parágrafo dela; arrastar a alça muda o tamanho.
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const box = target?.closest<HTMLElement>(".embedded-image");
      if (!box) return;
      e.preventDefault();
      const blockEl = box.closest<HTMLElement>("[data-block]");
      const index = Number(blockEl?.dataset.block);
      if (!blockEl || Number.isNaN(index)) return;
      root.focus();
      edit(() => ({ command: null, selection: { anchor: { block: index, offset: 0 }, focus: { block: index, offset: 0 } } }));
      if (!target?.dataset.handle) return;
      const image = latest.current.view.blocks[index]?.attrs.image;
      if (!image) return;
      const startX = e.clientX;
      const startWidth = box.getBoundingClientRect().width;
      const ptPerPx = image.width / startWidth;
      let next = image;
      const move = (ev: MouseEvent) => {
        next = resizeImage(image, (startWidth + ev.clientX - startX) * ptPerPx);
        box.style.width = `${next.width}pt`;
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (next !== image) edit((_doc, sel) => ({ command: setImage(index, next), selection: sel }));
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };

    // Ctrl+clique segue o link, como no Word.
    const onClick = (e: MouseEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // Entrada do Sumário: vai para o título, como os links do sumário do Word.
      const entry = (e.target as HTMLElement | null)?.closest<HTMLElement>(".toc-entry");
      const target = entry && tocTargets(latest.current.view.blocks).get(Number(entry.dataset.block));
      if (target !== undefined && target !== null) {
        e.preventDefault();
        const sel = { anchor: { block: target, offset: 0 }, focus: { block: target, offset: 0 } };
        writeSelection(root, sel);
        latest.current.onSelect(sel);
        root.querySelector(`[data-block="${target}"]`)?.scrollIntoView({ block: "start" });
        return;
      }
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-href]");
      if (!el?.dataset.href) return;
      e.preventDefault();
      latest.current.onOpenLink(el.dataset.href);
    };
    const pointerUp = (e: MouseEvent) => {
      // Clique triplo: o navegador estende a seleção até o começo do parágrafo
      // seguinte; o Word seleciona só o parágrafo clicado.
      if (e.detail >= 3) {
        const sel = readSelection(root);
        if (sel) {
          const [from, to] = ordered(sel);
          if (to.offset === 0 && to.block > from.block) {
            const end = { block: to.block - 1, offset: blockText(latest.current.view.blocks[to.block - 1]).length };
            writeSelection(root, { anchor: from, focus: end });
          }
        }
      }
      latest.current.onPointerUp();
    };

    root.addEventListener("beforeinput", onBeforeInput);
    root.addEventListener("compositionstart", onCompositionStart);
    root.addEventListener("compositionend", onCompositionEnd);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("copy", copy);
    root.addEventListener("cut", cut);
    root.addEventListener("paste", onPaste);
    root.addEventListener("dragstart", block);
    root.addEventListener("drop", block);
    root.addEventListener("mouseup", pointerUp);
    root.addEventListener("click", onClick);
    root.addEventListener("mousedown", onMouseDown);
    root.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      root.removeEventListener("beforeinput", onBeforeInput);
      root.removeEventListener("mousedown", onMouseDown);
      root.removeEventListener("compositionstart", onCompositionStart);
      root.removeEventListener("compositionend", onCompositionEnd);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("copy", copy);
      root.removeEventListener("cut", cut);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("dragstart", block);
      root.removeEventListener("drop", block);
      root.removeEventListener("mouseup", pointerUp);
      root.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);

  return (
    <div className={`paper${props.hfEditing ? " hf-mode" : ""}`} style={{ width: `${px(page.width)}px`, ...paperStyle(page) }}>
      <div className="sheets" aria-hidden="true">
        {Array.from({ length: pages }, (_, k) => (
          <div key={k} className="sheet" style={{ top: `${k * (px(page.height) + SHEET_GAP)}px`, height: `${px(page.height)}px` }}>
            <SheetDesign page={page} watermark={props.view.watermark} />
          </div>
        ))}
      </div>
    <div
      ref={rootRef}
      className={`page${props.showMarks ? " show-marks" : ""}`}
      style={{
        padding: `${px(page.marginTop)}px ${px(page.marginRight)}px ${px(page.marginBottom)}px ${px(page.marginLeft)}px`,
      }}
      contentEditable
      suppressContentEditableWarning
      // O corretor é o da NovaOffice (nova-spell), não o do WebView.
      spellCheck={false}
      role="textbox"
      aria-multiline="true"
      aria-label={t("editor.label")}
    >
      <Blocks
        blocks={props.view.blocks}
        showMarks={props.showMarks}
        caretBlock={props.selection.focus.block}
        revision={props.revision}
        labels={labels}
      />
    </div>
      <FootnotesLayer
        pages={notePages}
        texts={props.view.footnotes}
        pageHeight={px(page.height)}
        gap={SHEET_GAP}
        marginBottom={px(page.marginBottom)}
        marginLeft={px(page.marginLeft)}
        marginRight={px(page.marginRight)}
        focus={props.footnoteFocus}
        onFocused={props.onFootnoteFocused}
        onChange={props.onFootnoteChange}
        onDone={props.onFootnoteDone}
        label={(n) => t("fn.noteLabel", { n })}
      />
      <FootnotesPrint order={footnoteOrder(props.view.blocks)} texts={props.view.footnotes} title={t("fn.listTitle")} />
      <HeaderFooterLayer
        value={props.headerFooter}
        pages={pages}
        pageHeight={px(page.height)}
        gap={SHEET_GAP}
        distance={px(HEADER_DISTANCE)}
        marginLeft={px(page.marginLeft)}
        marginRight={px(page.marginRight)}
        editing={props.hfEditing}
        onEdit={props.onHfEdit}
        onChange={props.onHfChange}
        onClose={props.onHfClose}
      />
      <PrintDesign page={page} watermark={props.view.watermark} />
    </div>
  );
}

function matchRange(root: HTMLElement, m: Match): Range | null {
  const start = posToDom(root, { block: m.block, offset: m.start });
  const end = posToDom(root, { block: m.block, offset: m.end });
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1]);
  return range;
}

/** Posição do modelo sob o ponteiro (clique direito). */
function posFromPoint(root: HTMLElement, x: number, y: number): Pos | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const caretPos = doc.caretPositionFromPoint?.(x, y);
  if (caretPos) return posFromDom(root, caretPos.offsetNode, caretPos.offset);
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? posFromDom(root, range.startContainer, range.startOffset) : null;
}

/**
 * Identidade de cada parágrafo. O remendo do núcleo mantém os objetos dos
 * parágrafos que não mudaram, então eles continuam com a mesma chave e não são
 * redesenhados; parágrafos alterados são objetos novos e ganham DOM novo,
 * descartando qualquer coisa que o navegador tenha escrito neles.
 */
const blockIds = new WeakMap<BlockView, number>();
let nextBlockId = 0;
function blockId(block: BlockView): number {
  let id = blockIds.get(block);
  if (id === undefined) {
    id = ++nextBlockId;
    blockIds.set(block, id);
  }
  return id;
}

interface Labels {
  pageBreak: string;
  followLink: string;
}

function Blocks({
  blocks,
  showMarks,
  caretBlock,
  revision,
  labels,
}: {
  blocks: BlockView[];
  showMarks: boolean;
  caretBlock: number;
  revision: number;
  labels: Labels;
}) {
  const markers = listMarkers(blocks);
  // O parágrafo do cursor é sempre recriado depois de uma edição: é onde o
  // navegador pode ter escrito (composição de acentos e IME).
  const render = (i: number) => (
    <Block
      key={i === caretBlock ? `${blockId(blocks[i])}-${revision}` : blockId(blocks[i])}
      index={i}
      block={blocks[i]}
      marker={markers[i]}
      showMarks={showMarks}
      labels={labels}
    />
  );
  const out: JSX.Element[] = [];
  let i = 0;
  while (i < blocks.length) {
    const table = blocks[i].attrs.cell?.table;
    if (!table) {
      out.push(render(i));
      i++;
      continue;
    }
    let end = i + 1;
    while (end < blocks.length && blocks[end].attrs.cell?.table === table) end++;
    const grid = tableGrid({ blocks }, i, end);
    out.push(
      <table key={`table-${table}-${i}`} className="nova-table" data-table={table}>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const shading = cell.length ? blocks[cell[0]].attrs.shading : null;
                return cell.length ? (
                  <td key={c} style={shading ? { background: shading, color: isDark(shading) ? "#fff" : undefined } : undefined}>
                    {cell.map(render)}
                  </td>
                ) : (
                  <td key={c} className="missing" contentEditable={false} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>,
    );
    i = end;
  }
  return <>{out}</>;
}

const Block = memo(function Block({
  index,
  block,
  marker,
  showMarks,
  labels,
}: {
  index: number;
  block: BlockView;
  marker: string | null;
  showMarks: boolean;
  labels: Labels;
}) {
  const Tag = tagFor(block.style);
  const empty = block.spans.every((s) => s.text === "");
  const image = block.attrs.image;
  return (
    <Tag
      data-block={index}
      data-marker={marker ?? undefined}
      className={`block block-${block.style}${marker ? ` list list-${block.attrs.list}` : ""}${block.attrs.pageBreakBefore ? " page-break" : ""}${tocClass(block)}`}
      data-page-break={block.attrs.pageBreakBefore ? labels.pageBreak : undefined}
      style={paragraphStyle(block.attrs)}
    >
      {image && <EmbeddedImage image={image} />}
      {empty ? (
        image ? null : <br />
      ) : (
        block.spans.map((span, j) => (
          <span
            key={j}
            style={spanStyle(span.marks)}
            data-fn={footnoteOf(span.marks) ?? undefined}
            className={footnoteOf(span.marks) ? "fn-ref" : linkOf(span.marks) ? "link" : undefined}
            data-href={linkOf(span.marks) ?? undefined}
            title={linkOf(span.marks) ? `${linkOf(span.marks)}\n${labels.followLink}` : undefined}
          >
            {showMarks ? visibleMarks(span.text) : lineBreaks(span.text)}
          </span>
        ))
      )}
      {/* Uma quebra de linha no fim só aparece com um <br> depois dela. */}
      {!empty && blockText(block).endsWith(LINE_BREAK) && <br />}
    </Tag>
  );
});

/**
 * Imagem no parágrafo. Fica fora da edição de texto (contentEditable=false);
 * a alça no canto muda o tamanho mantendo a proporção.
 */
function EmbeddedImage({ image }: { image: ImageRef }) {
  const [url, setUrl] = useState(() => cachedMediaUrl(image.id));
  useEffect(() => {
    let alive = true;
    mediaUrl(image.id, api.media).then((u) => alive && u && setUrl(u));
    return () => {
      alive = false;
    };
  }, [image.id]);
  return (
    <span className="embedded-image" contentEditable={false} data-image={image.id} style={{ width: `${image.width}pt`, aspectRatio: `${image.width} / ${image.height}` }}>
      {url ? <img src={url} alt="" draggable={false} /> : null}
      <span className="image-handle" data-handle="se" />
    </span>
  );
}

/** A quebra de linha do modelo (U+000B) aparece como \n, que o CSS pre-wrap quebra; mesmo comprimento. */
const lineBreaks = (text: string) => text.replace(/\u000B/g, "\n");

/** Espaço vira · e tabulação vira →, com o mesmo comprimento (offsets não mudam). */
const visibleMarks = (text: string) => lineBreaks(text).replace(/ /g, "·").replace(/\t/g, "→");

/** Classes do parágrafo do Sumário: título ou entrada (com o nível). */
function tocClass(block: BlockView): string {
  const toc = block.attrs.toc;
  if (!toc) return "";
  return toc.level === 0 ? " toc-title" : ` toc-entry toc-${Math.min(toc.level, 6)}`;
}

function paragraphStyle(attrs: ParaAttrs | undefined): CSSProperties | undefined {
  if (!attrs) return undefined;
  const style: CSSProperties = {};
  if (attrs.align !== "left") style.textAlign = attrs.align;
  const levels = attrs.indent + (attrs.list ? 1 : 0);
  if (levels) style.marginLeft = `calc(${INDENT_STEP} * ${levels})`;
  // "Simples" no Word corresponde a cerca de 1,15 da altura da fonte.
  if (attrs.lineSpacing !== null) style.lineHeight = String((attrs.lineSpacing / 100) * 1.15);
  if (attrs.spaceBefore !== null) style.marginTop = `${attrs.spaceBefore}pt`;
  if (attrs.spaceAfter !== null) style.marginBottom = `${attrs.spaceAfter}pt`;
  // Na tabela, o fundo é da célula (td).
  if (attrs.shading && !attrs.cell) {
    style.background = attrs.shading;
    style.paddingInline = "4pt";
    // Cor "automática": o texto sem cor própria fica claro sobre fundo escuro.
    if (isDark(attrs.shading)) style.color = "#fff";
  }
  return style;
}

function tagFor(style: BlockView["style"]): keyof JSX.IntrinsicElements {
  switch (style) {
    case "heading1":
      return "h1";
    case "heading2":
      return "h2";
    case "heading3":
      return "h3";
    case "heading4":
      return "h4";
    case "heading5":
      return "h5";
    case "heading6":
      return "h6";
    case "quote":
      return "blockquote";
    case "code":
      return "pre";
    default:
      return "p";
  }
}

function spanStyle(marks: Mark[]): CSSProperties | undefined {
  if (marks.length === 0) return undefined;
  const style: CSSProperties = {};
  const decorations: string[] = [];
  for (const m of marks) {
    switch (m.mark) {
      case "bold":
        style.fontWeight = 700;
        break;
      case "italic":
        style.fontStyle = "italic";
        break;
      case "underline":
        decorations.push("underline");
        break;
      case "strike":
        decorations.push("line-through");
        break;
      case "fontFamily":
        style.fontFamily = `'${m.value}'`;
        break;
      case "fontSize":
        style.fontSize = `${m.halfPoints / 2}pt`;
        break;
      case "color":
        style.color = m.value;
        break;
      case "highlight":
        style.backgroundColor = HIGHLIGHT_CSS[m.value];
        break;
      case "vertAlign":
        style.verticalAlign = m.value === "superscript" ? "super" : "sub";
        break;
    }
  }
  // Sobrescrito e subscrito ficam com 65% do tamanho do trecho, como no Word.
  const vert = marks.some((m) => m.mark === "vertAlign");
  if (vert) {
    const size = marks.find((m) => m.mark === "fontSize");
    style.fontSize = size && size.mark === "fontSize" ? `${(size.halfPoints / 2) * 0.65}pt` : "0.65em";
  }
  if (decorations.length) style.textDecoration = decorations.join(" ");
  return style;
}

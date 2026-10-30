import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { Backstage, LOSSY, SAVE_FORMATS, type BackstagePage } from "./Backstage";
import { insertFragment, NOVA_MIME, parseHtml, plainFragment, type Fragment } from "./clipboard";
import { writeSelection } from "./dom";
import { Editor, type EditFn } from "./Editor";
import { matchSelection, nextMatch, replaceAll, replaceMatch, type Match } from "./find";
import { FindPanel, useMatches, type FindState } from "./FindPanel";
import {
  changeCase,
  changeIndent,
  commonAttr,
  commonMark,
  dateTimeFormats,
  DEFAULT_FONT,
  insertPageBreak,
  linkOf,
  linkRangeAt,
  effectiveSize,
  formatTarget,
  growFont,
  nextCaseMode,
  removeMarks,
  setMark,
  setParaAttr,
  stepSize,
  toggleList,
  type CaseMode,
} from "./formatting";
import { useI18n, type MessageKey } from "./i18n";
import {
  blockText,
  caret,
  clampSelection,
  comparePos,
  firstDifference,
  isCollapsed,
  markActive,
  insertText,
  marksAt,
  ordered,
  setStyle,
  toggleMark,
  toggledMarks,
  wordCount,
  type Selection,
} from "./model";
import { Ribbon, type RibbonCommand } from "./Ribbon";
import { SaveChangesDialog, type SaveChoice } from "./SaveDialog";
import { DateTimeDialog, LinkDialog, MarginsDialog, type LinkRequest } from "./Insert";
import { insertFieldAtCaret, NUMPAGES_FIELD, PAGE_FIELD, type Part } from "./headerfooter";
import { deleteColumns, deleteRows, deleteTable, insertColumn, insertRow, insertTable } from "./tables";
import { fileToBase64, insertImage, resizeImage, setImage, TEXT_WIDTH_PT } from "./images";
import { defaultProofing, matchAt, matchText, parseProofing, SPELL_LANGUAGES, useSpelling, type Proofing } from "./spell";
import { ReviewTab, useReviewShortcuts } from "./ReviewTab";
import { DesignTab } from "./DesignTab";
import { ReferencesTab } from "./ReferencesTab";
import { insertFootnote, newFootnoteId, nextFootnote } from "./footnotes";
import { addComment, commentAt, commentTarget, deleteAllComments, deleteComment, initialsOf, newCommentId, nextComment, nowIso, type Pending } from "./comments";
import { findToc, insertToc, removeToc, screenPages, updateToc } from "./toc";
import { SpellingPane } from "./SpellingPane";
import { AutoCorrectDialog } from "./AutoCorrectDialog";
import { WordCountDialog } from "./WordCountDialog";
import { autoCorrect, loadAutoCorrect, storeAutoCorrect, type AutoCorrectOptions } from "./autocorrect";
import type { Comment, Pos } from "./types";
import { SpellMenu } from "./SpellMenu";
import { load, store } from "./storage";
import { matchShortcut, profileFor } from "./shortcuts";
import { useTheme } from "./theme";
import { applyPatch, DEFAULT_HEADER_FOOTER, DEFAULT_PAGE, type HeadersFooters, type BlockStyle, type PageSetup, type DocView, type FileFormat, type Recent, type RecoveryInfo, type HighlightColor, type Mark, type MarkKind, type ParaAttr, type TextCommand, type ToggleMark } from "./types";
import { AboutPage, ReleaseNotesDialog, UpdateBar, useUpdates } from "./UpdateBar";
import { updateApi } from "./update";
import { NavigationPane, Ruler, ViewTab, ZoomControl, type ZoomFit } from "./ViewTab";
import { fitPage, fitWidth, headings as listHeadings, stepZoom } from "./zoom";

interface State {
  view: DocView;
  /** Muda a cada resposta do núcleo; o editor redesenha o DOM do zero. */
  revision: number;
  selection: Selection;
}

const START = caret({ block: 0, offset: 0 });

const sameSelection = (a: Selection, b: Selection) =>
  comparePos(a.anchor, b.anchor) === 0 && comparePos(a.focus, b.focus) === 0;

/** Espaço que "Adicionar espaço antes/depois" põe, como no Word (12 pt). */
const PARAGRAPH_SPACE = 12;

/** Intervalo da recuperação automática (o Word usa 10 min; aqui é mais curto). */
const AUTOSAVE_MS = 60_000;

const EMPTY_VIEW: DocView = { blocks: [], canUndo: false, canRedo: false, path: null, title: "", dirty: false, format: null, page: DEFAULT_PAGE, headerFooter: DEFAULT_HEADER_FOOTER, watermark: null, footnotes: {}, comments: {} };

/** Idioma de revisão escolhido na barra de status (sem escolha, segue o da interface). */
const PROOFING_KEY = "nova.proofing";

/** Aba Exibir: Régua e Painel de Navegação ficam como o usuário deixou. */
const RULER_KEY = "nova.view.ruler";
const NAVIGATION_KEY = "nova.view.navigation";

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Mark[] | null>(null);
  const [status, setStatus] = useState("");
  const [showMarks, setShowMarks] = useState(false);
  const [painter, setPainter] = useState<{ marks: Mark[]; sticky: boolean } | null>(null);
  const [lastFontColor, setLastFontColor] = useState("#C00000");
  const [lastHighlight, setLastHighlight] = useState<HighlightColor>("yellow");
  const [lastShading, setLastShading] = useState("#D9E2F3");
  const [linkRequest, setLinkRequest] = useState<LinkRequest | null>(null);
  const [pageInfo, setPageInfo] = useState({ pages: 1, current: 1 });
  const [marginsDialog, setMarginsDialog] = useState(false);
  const [dateDialog, setDateDialog] = useState(false);
  const [find, setFind] = useState<FindState | null>(null);
  // Tela Arquivo; na inicialização, com um documento vazio, é a tela inicial do NovaOffice.
  const [backstage, setBackstage] = useState<BackstagePage | null>(null);
  const [startup, setStartup] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [recovery, setRecovery] = useState<RecoveryInfo | null>(null);
  const [saveAsk, setSaveAsk] = useState<{ title: string; resolve: (choice: SaveChoice) => void } | null>(null);
  const { t, locale } = useI18n();
  const [proofingChoice, setProofingChoice] = useState<Proofing | null>(() => parseProofing(load(PROOFING_KEY)));
  const proofing = proofingChoice ?? defaultProofing(locale);
  const [spellMenu, setSpellMenu] = useState<{ match: Match; word: string; x: number; y: number } | null>(null);
  /** Painel Ortografia (F7): de onde começa e quantas vezes foi aberto. */
  const [spellPane, setSpellPane] = useState<{ start: Pos; token: number } | null>(null);
  const profile = profileFor(locale);
  const [theme, setTheme] = useTheme();
  // Callbacks estáveis leem a tradução atual daqui; trocar de idioma não os recria.
  const tRef = useRef(t);
  tRef.current = t;

  // Fonte da verdade fora do ciclo de render: comandos enfileirados leem daqui
  // o estado deixado pelo comando anterior, mesmo antes de o React redesenhar.
  const stateRef = useRef<State | null>(null);
  const pendingRef = useRef<Mark[] | null>(null);
  const painterRef = useRef(painter);
  painterRef.current = painter;
  /** Formatação guardada por Ctrl+Shift+C, para Ctrl+Shift+V. */
  const formatClipboard = useRef<Mark[] | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Chamado depois de cada edição aplicada (a AutoCorreção olha a tecla digitada). */
  const afterEdit = useRef<(command: TextCommand, view: DocView) => void>(() => {});
  /** Fim do texto digitado em sequência, e a correção a caminho (que não interrompe a sequência). */
  const typedEnd = useRef<Pos | null>(null);
  const correctionRef = useRef<TextCommand | null>(null);
  /** Correções na fila: as que vêm depois andam junto quando uma anterior muda o tamanho do texto. */
  const pendingFixes = useRef<{ block: number; start: number; end: number }[]>([]);

  const commit = useCallback((next: State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const setPending = useCallback((marks: Mark[] | null) => {
    pendingRef.current = marks;
    setPendingMarks(marks);
  }, []);

  const showError = useCallback((error: unknown) => setStatus(tRef.current("app.error", { error: String(error) })), []);

  /** Enfileira uma edição; cada uma vê o resultado da anterior. */
  const run = useCallback(
    (fn: EditFn) => {
      queue.current = queue.current.then(async () => {
        const current = stateRef.current;
        if (!current) return;
        const edit = fn(current.view, current.selection);
        if (!edit) return;
        try {
          let view = current.view;
          let selection = edit.selection;
          if (edit.command) {
            const { patch } = await api.dispatch(edit.command);
            // Se o remendo não bater (não deveria), busca o documento inteiro.
            view = applyPatch(current.view, patch) ?? (await api.snapshot());
            // Desfazer/refazer: o cursor vai para onde o documento mudou.
            if (edit.command.type === "history.undo" || edit.command.type === "history.redo") {
              const at = firstDifference(current.view, view);
              if (at) selection = caret(at);
            }
          }
          if (edit.command) setPending(null);
          commit({ view, revision: current.revision + 1, selection: clampSelection(view, selection) });
          if (edit.command) afterEdit.current(edit.command, view);
          setStatus("");
        } catch (error) {
          showError(error);
          commit({ ...current, revision: current.revision + 1 });
        }
      });
    },
    [commit, setPending, showError],
  );

  const runCommand = useCallback(
    (command: TextCommand | null) => run((_doc, sel) => ({ command, selection: sel })),
    [run],
  );

  const loadView = useCallback(
    (view: DocView) => {
      setPending(null);
      commit({ view, revision: (stateRef.current?.revision ?? 0) + 1, selection: START });
    },
    [commit, setPending],
  );

  const refreshRecents = useCallback(() => {
    api.recentDocuments().then(setRecents, () => {});
  }, []);

  useEffect(() => {
    api.snapshot().then((view) => {
      // Aberto já com um documento (arquivo passado ao programa, por exemplo): vai direto a ele.
      const pristine = !view.path && !view.dirty && view.blocks.length <= 1 && !view.blocks[0]?.spans.some((s) => s.text);
      if (pristine) {
        setStartup(true);
        setBackstage("home");
      }
      loadView(view);
    }, showError);
    api.recoveryInfo().then(setRecovery, () => {});
    refreshRecents();
  }, [loadView, showError, refreshRecents]);

  // Título da janela: nome do arquivo e um ponto quando há alterações não salvas.
  useEffect(() => {
    if (!state) return;
    const name = state.view.format ? `${state.view.title}.${state.view.format}` : state.view.title;
    const title = startup ? "NovaOffice" : `${state.view.dirty ? "● " : ""}${name} — Nova Text`;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [state?.view.title, state?.view.dirty, state?.view.format, startup]);

  const onSelect = useCallback(
    (selection: Selection) => {
      const current = stateRef.current;
      if (!current || sameSelection(current.selection, selection)) return;
      if (pendingRef.current) setPending(null);
      commit({ ...current, selection });
    },
    [commit, setPending],
  );

  const pageElement = () => document.querySelector<HTMLElement>(".page");

  /** Devolve o foco ao documento com a seleção do modelo (depois de usar um campo da faixa). */
  const focusEditor = useCallback(() => {
    const root = pageElement();
    const current = stateRef.current;
    if (!root || !current) return;
    root.focus();
    writeSelection(root, current.selection);
  }, []);

  // ---------- Fonte ----------

  /**
   * Aplica uma mudança de formatação de caractere: na seleção, ou na palavra
   * sob o cursor (Word); fora de palavras, guarda para o próximo texto digitado.
   */
  const applyCharFormat = useCallback(
    (
      onRange: (doc: DocView, sel: Selection) => TextCommand | null,
      onPending: (current: Mark[]) => Mark[],
    ) => {
      const current = stateRef.current;
      if (!current) return;
      const target = formatTarget(current.view, current.selection);
      if (!target) {
        setPending(onPending(pendingRef.current ?? marksAt(current.view, current.selection.focus)));
        return;
      }
      run((doc, sel) => ({ command: onRange(doc, formatTarget(doc, sel) ?? sel), selection: sel }));
    },
    [run, setPending],
  );

  const replaceKind = (marks: Mark[], kind: MarkKind, mark: Mark | null) => [
    ...marks.filter((m) => m.mark !== kind),
    ...(mark ? [mark] : []),
  ];

  const onToggleMark = useCallback(
    (kind: ToggleMark) =>
      applyCharFormat(
        (doc, sel) => toggleMark(doc, sel, kind),
        (current) => toggledMarks(current, kind),
      ),
    [applyCharFormat],
  );

  /** Marca com valor (fonte, tamanho, cor, realce, sobrescrito); `null` remove. */
  const onValueMark = useCallback(
    (kind: MarkKind, mark: Mark | null) =>
      applyCharFormat(
        (doc, sel) => (mark ? setMark(doc, sel, mark) : removeMarks(doc, sel, [kind])),
        (current) => replaceKind(current, kind, mark),
      ),
    [applyCharFormat],
  );

  const onVertAlign = useCallback(
    (value: "superscript" | "subscript") => {
      const current = stateRef.current;
      if (!current) return;
      const target = formatTarget(current.view, current.selection) ?? current.selection;
      const on = commonMark(current.view, target, "vertAlign", pendingRef.current ?? marksAt(current.view, current.selection.focus));
      onValueMark("vertAlign", on?.value === value ? null : { mark: "vertAlign", value });
    },
    [onValueMark],
  );

  const onCase = useCallback(
    (mode: CaseMode | "cycle") => {
      run((doc, sel) => {
        const target = formatTarget(doc, sel);
        if (!target) return null;
        const [from, to] = ordered(target);
        const text = blockText(doc.blocks[from.block]).slice(from.offset, from.block === to.block ? to.offset : undefined);
        const resolved = mode === "cycle" ? nextCaseMode(text, locale) : mode;
        const { command, selection } = changeCase(doc, target, resolved, locale);
        return { command, selection: isCollapsed(sel) ? sel : selection };
      });
    },
    [run, locale],
  );

  // ---------- Parágrafo ----------

  const onParaAttr = useCallback(
    (attr: ParaAttr) => run((doc, sel) => ({ command: setParaAttr(doc, sel, attr), selection: sel })),
    [run],
  );

  const onStyle = useCallback(
    (style: BlockStyle) => {
      focusEditor();
      run((doc, sel) => ({ command: setStyle(doc, sel, style), selection: sel }));
    },
    [run, focusEditor],
  );

  // ---------- Área de transferência ----------

  const pasteFragment = useCallback(
    (fragment: Fragment) => run((doc, sel) => insertFragment(doc, sel, fragment)),
    [run],
  );

  /** Botão Colar: lê a área de transferência do sistema (Ctrl+V usa o evento paste do Editor). */
  const pasteFromRibbon = useCallback(
    async (mode: "keep" | "text") => {
      focusEditor();
      try {
        let fragment: Fragment | null = null;
        if (mode === "keep" && navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes(NOVA_MIME)) fragment = JSON.parse(await (await item.getType(NOVA_MIME)).text());
            else if (item.types.includes("text/html")) fragment = parseHtml(await (await item.getType("text/html")).text());
            if (fragment?.length) break;
          }
        }
        if (!fragment?.length) {
          const text = await navigator.clipboard.readText();
          const current = stateRef.current;
          const marks = current ? pendingRef.current ?? marksAt(current.view, ordered(current.selection)[0]) : [];
          fragment = plainFragment(text, marks);
        }
        pasteFragment(fragment);
      } catch {
        setStatus(tRef.current("status.clipboardDenied"));
      }
    },
    [focusEditor, pasteFragment],
  );

  // ---------- Inserir ----------

  const insertTextAtCaret = useCallback(
    (text: string) => {
      focusEditor();
      run((doc, sel) => insertText(doc, sel, text));
    },
    [run, focusEditor],
  );

  /** Ctrl+K: com o cursor num link, seleciona o link inteiro para editar. */
  const openLinkDialog = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const { view, selection } = current;
    if (isCollapsed(selection)) {
      const range = linkRangeAt(view, selection.focus);
      if (range) {
        const block = selection.focus.block;
        const sel = { anchor: { block, offset: range.from }, focus: { block, offset: range.to } };
        commit({ ...current, selection: sel });
        setLinkRequest({ text: blockText(view.blocks[block]).slice(range.from, range.to), href: range.href, hasSelection: true });
        return;
      }
      setLinkRequest({ text: "", href: null, hasSelection: false });
      return;
    }
    const [from, to] = ordered(selection);
    const text = from.block === to.block ? blockText(view.blocks[from.block]).slice(from.offset, to.offset) : "";
    setLinkRequest({ text, href: linkOf(marksAt(view, { ...from, offset: from.offset + 1 })), hasSelection: true });
  }, [commit]);

  const closeLinkDialog = useCallback(() => {
    setLinkRequest(null);
    setTimeout(focusEditor, 0);
  }, [focusEditor]);

  const applyLink = (text: string, href: string) => {
    const request = linkRequest;
    closeLinkDialog();
    if (!request) return;
    const mark: Mark = { mark: "link", href };
    run((doc, sel) => {
      if (request.hasSelection && !isCollapsed(sel)) return { command: setMark(doc, sel, mark), selection: caret(ordered(sel)[1]) };
      const marks = [...marksAt(doc, ordered(sel)[0]).filter((m) => m.mark !== "link"), mark];
      return insertText(doc, sel, text, marks);
    });
  };

  const removeLink = () => {
    closeLinkDialog();
    run((doc, sel) => ({ command: removeMarks(doc, sel, ["link"]), selection: caret(ordered(sel)[1]) }));
  };

  /** Inserir → Imagens: escolhe o arquivo, guarda no documento e insere no cursor. */
  const insertPicture = () =>
    afterQueue(async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: tRef.current("insert.imageFilter"), extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp"] }],
      });
      if (!path) return;
      const image = await api.addImageFile(path);
      focusEditor();
      run((doc, sel) => insertImage(doc, sel, image));
    });

  const pasteImage = useCallback(
    (file: File) => {
      fileToBase64(file)
        .then((data) => api.addImageData(data))
        .then((image) => run((doc, sel) => insertImage(doc, sel, image)), showError);
    },
    [run, showError],
  );

  /** Formato da Imagem: largura em % da largura do texto, mantendo a proporção. */
  const sizeImage = (percent: number | null) =>
    run((doc, sel) => {
      const block = sel.focus.block;
      const image = doc.blocks[block]?.attrs.image;
      if (!image) return null;
      const width = percent === null ? Math.min(image.width, TEXT_WIDTH_PT) : (TEXT_WIDTH_PT * percent) / 100;
      return { command: setImage(block, resizeImage(image, width)), selection: sel };
    });

  /** Aba Layout: papel, margens e orientação (um passo de desfazer). */
  // ---------- Cabeçalho e rodapé ----------

  // Durante a edição, o texto fica num rascunho; vai para o documento ao sair
  // (ou ao usar um botão da aba), num passo de desfazer.
  const [hfEditing, setHfEditing] = useState<{ part: Part; page: number } | null>(null);
  // Nota de rodapé recém-inserida: o Editor põe o cursor nela.
  const [footnoteFocus, setFootnoteFocus] = useState<string | null>(null);

  // ---------- Comentários ----------
  const [showComments, setShowComments] = useState(() => load("nova.showComments") !== "0");
  const [author, setAuthor] = useState(() => load("nova.author") ?? "");
  // Comentário ativo: o do cursor, ou o balão clicado.
  const [cmActive, setCmActive] = useState<string | null>(null);
  const [cmPending, setCmPending] = useState<Pending | null>(null);
  const cmSelection = state ? `${state.selection.focus.block}:${state.selection.focus.offset}` : "";
  useEffect(() => {
    const current = stateRef.current;
    if (current) setCmActive(commentAt(current.view, current.selection.focus));
  }, [cmSelection]);
  const commentAuthor = (name: string) => {
    if (name && name !== author) {
      setAuthor(name);
      store("nova.author", name);
    }
  };
  const cmComment = (text: string, name: string, parent?: string): Comment => ({
    author: name,
    initials: initialsOf(name),
    date: nowIso(),
    text,
    done: false,
    ...(parent ? { parent } : {}),
  });
  const commentHandlers = {
    active: cmActive,
    pending: cmPending,
    author,
    onActivate: setCmActive,
    onPost: (text: string, name: string) => {
      const pending = cmPending;
      setCmPending(null);
      if (!pending) return;
      commentAuthor(name);
      const id = newCommentId();
      focusEditor();
      run((doc) => addComment(doc, pending.target, id, cmComment(text, name)));
      setCmActive(id);
    },
    onCancel: () => {
      setCmPending(null);
      focusEditor();
    },
    onReply: (root: string, text: string) =>
      run((_doc, sel) => ({ command: { type: "comment.set", id: newCommentId(), value: cmComment(text, author, root) }, selection: sel })),
    onEdit: (id: string, text: string) =>
      run((doc, sel) => (doc.comments[id] ? { command: { type: "comment.set", id, value: { ...doc.comments[id], text } }, selection: sel } : null)),
    onResolve: (root: string, done: boolean) =>
      run((doc, sel) => (doc.comments[root] ? { command: { type: "comment.set", id: root, value: { ...doc.comments[root], done } }, selection: sel } : null)),
    onDelete: (root: string) => {
      setCmActive(null);
      run((doc, sel) => deleteComment(doc, sel, root));
    },
    onDone: () => focusEditor(),
  };
  const [hfDraft, setHfDraft] = useState<HeadersFooters | null>(null);
  const hfDraftRef = useRef(hfDraft);
  hfDraftRef.current = hfDraft;

  const commitHeaderFooter = useCallback(
    (value: HeadersFooters | null = hfDraftRef.current) => {
      const current = stateRef.current;
      if (!value || !current || JSON.stringify(value) === JSON.stringify(current.view.headerFooter)) return;
      runCommand({ type: "headerFooter.set", value });
    },
    [runCommand],
  );

  const editHeaderFooter = useCallback(
    (part: Part, page = 0) => {
      const base = hfDraftRef.current ?? stateRef.current?.view.headerFooter ?? DEFAULT_HEADER_FOOTER;
      commitHeaderFooter(base);
      setHfDraft(base);
      // Com "Primeira Página Diferente", edita a segunda página (a primeira fica vazia).
      setHfEditing({ part, page: base.differentFirst && page === 0 && pageInfo.pages > 1 ? 1 : page });
    },
    [commitHeaderFooter, pageInfo.pages],
  );

  const closeHeaderFooter = useCallback(() => {
    commitHeaderFooter();
    setHfEditing(null);
    setHfDraft(null);
    setTimeout(focusEditor, 0);
  }, [commitHeaderFooter, focusEditor]);

  /** Muda o rascunho (ou, fora da edição, o documento direto). */
  const updateHeaderFooter = (change: (hf: HeadersFooters) => HeadersFooters) => {
    const base = hfDraftRef.current ?? stateRef.current?.view.headerFooter ?? DEFAULT_HEADER_FOOTER;
    const next = change(base);
    if (hfEditing) {
      setHfDraft(next);
      commitHeaderFooter(next);
    } else {
      commitHeaderFooter(next);
    }
  };

  /** Inserir → Número de Página: posição pronta (no cabeçalho ou no rodapé). */
  const pageNumberAt = (part: Part, align: "left" | "center" | "right", xOfY = false) =>
    updateHeaderFooter((hf) => ({ ...hf, [part]: { text: xOfY ? t("hf.pageXofYText") : PAGE_FIELD, align } }));

  const removePageNumbers = () =>
    updateHeaderFooter((hf) => {
      const strip = (text: string) => text.split(PAGE_FIELD).join("").split(NUMPAGES_FIELD).join("").replace(/^(Página|Page)\s*(de|of)?\s*$/i, "").trim();
      return { ...hf, header: { ...hf.header, text: strip(hf.header.text) }, footer: { ...hf.footer, text: strip(hf.footer.text) } };
    });

  const setPage = useCallback(
    (page: PageSetup) => {
      focusEditor();
      runCommand({ type: "page.set", page });
    },
    [focusEditor, runCommand],
  );

  const openLink = useCallback(
    (href: string) => {
      openUrl(href).catch(showError);
    },
    [showError],
  );

  // ---------- Pincel de Formatação ----------

  const marksForPainter = (view: DocView, sel: Selection) =>
    isCollapsed(sel) ? marksAt(view, sel.focus) : marksAt(view, { ...ordered(sel)[0], offset: ordered(sel)[0].offset + 1 });

  const applyMarks = useCallback(
    (marks: Mark[]) =>
      run((doc, sel) => {
        const target = formatTarget(doc, sel);
        if (!target) return null;
        const commands = [removeMarks(doc, target, "all"), ...marks.map((m) => setMark(doc, target, m))].filter(
          (c): c is TextCommand => !!c,
        );
        const flat = commands.flatMap((c) => (c.type === "batch" ? c.commands : [c]));
        return { command: flat.length ? { type: "batch", commands: flat } : null, selection: sel };
      }),
    [run],
  );

  const onPainter = useCallback((sticky: boolean) => {
    const current = stateRef.current;
    if (!current) return;
    if (painterRef.current && !sticky) {
      setPainter(null);
      return;
    }
    setPainter({ marks: marksForPainter(current.view, current.selection), sticky });
  }, []);

  const onPointerUp = useCallback(() => {
    const p = painterRef.current;
    if (!p) return;
    // Espera a seleção do mouse chegar ao modelo (selectionchange) antes de aplicar.
    setTimeout(() => {
      applyMarks(p.marks);
      if (!p.sticky) setPainter(null);
    }, 0);
  }, [applyMarks]);

  // ---------- Localizar ----------

  const matches = useMatches(state?.view ?? EMPTY_VIEW, find);

  const openFind = useCallback((mode: "find" | "replace") => {
    const current = stateRef.current;
    const selected =
      current && !isCollapsed(current.selection) && ordered(current.selection)[0].block === ordered(current.selection)[1].block
        ? blockText(current.view.blocks[ordered(current.selection)[0].block]).slice(ordered(current.selection)[0].offset, ordered(current.selection)[1].offset)
        : null;
    setFind((f) => ({
      mode: mode === "replace" || f?.mode === "replace" ? mode : "find",
      query: selected ?? f?.query ?? "",
      replacement: f?.replacement ?? "",
      options: f?.options ?? { matchCase: false, wholeWord: false },
      current: -1,
      notice: "",
      focusToken: (f?.focusToken ?? 0) + 1,
    }));
  }, []);

  const goToMatch = useCallback(
    (index: number) => {
      const m = matches[index];
      if (!m) return;
      setFind((f) => (f ? { ...f, current: index, notice: "" } : f));
      run(() => ({ command: null, selection: matchSelection(m) }));
    },
    [matches, run],
  );

  const replaceCurrent = useCallback(() => {
    if (!find) return;
    const m = matches[find.current];
    if (!m) {
      // Sem resultado atual: vai para o primeiro a partir do cursor, como o Word.
      const current = stateRef.current;
      if (current) goToMatch(nextMatch(matches, ordered(current.selection)[0]));
      return;
    }
    run((doc) => ({
      command: replaceMatch(doc, m, find.replacement),
      selection: caret({ block: m.block, offset: m.start + find.replacement.length }),
    }));
    // O índice continua o mesmo: a ocorrência seguinte passa a ocupar esta posição.
    setFind((f) => (f ? { ...f, current: Math.min(f.current, matches.length - 2) } : f));
  }, [find, matches, run, goToMatch]);

  const replaceEverything = useCallback(() => {
    if (!find) return;
    run((doc, sel) => {
      const { command, count } = replaceAll(doc, find.query, find.replacement, find.options);
      setFind((f) => (f ? { ...f, current: -1, notice: tRef.current("find.replaced", { count }) } : f));
      return { command, selection: sel };
    });
  }, [find, run]);

  // Quando o resultado atual muda (substituição), mantém a seleção nele.
  useEffect(() => {
    if (!find || find.current < 0) return;
    const m = matches[find.current];
    if (m) run(() => ({ command: null, selection: matchSelection(m) }));
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Ortografia ----------

  const spelling = useSpelling(state?.view ?? EMPTY_VIEW, state?.selection ?? START, proofing);

  const onContextMenu = (pos: { block: number; offset: number }, x: number, y: number) => {
    const current = stateRef.current;
    const match = proofing === "off" || !current ? null : matchAt(spelling.all, pos);
    if (!current || !match) return false;
    setSpellMenu({ match, word: matchText(current.view, match), x, y });
    return true;
  };

  const closeSpellMenu = useCallback(() => {
    setSpellMenu(null);
    focusEditor();
  }, [focusEditor]);

  const pickSuggestion = (match: Match, word: string, suggestion: string) => {
    closeSpellMenu();
    replaceWord(match, word, suggestion);
  };

  const replaceWord = (match: Match, word: string, suggestion: string) => {
    run((doc) =>
      // O documento pode ter mudado com o menu aberto: só troca se a palavra continua lá.
      matchText(doc, match) === word
        ? { command: replaceMatch(doc, match, suggestion), selection: caret({ block: match.block, offset: match.start + suggestion.length }) }
        : null,
    );
  };

  const chooseProofing = (value: Proofing) => {
    setProofingChoice(value);
    store(PROOFING_KEY, value);
    focusEditor();
  };

  const openSpellPane = () => {
    const current = stateRef.current;
    if (!current) return;
    setSpellPane((p) => ({ start: ordered(current.selection)[0], token: (p?.token ?? 0) + 1 }));
  };

  // ---------- AutoCorreção ----------

  const [autoCorrectOptions, setAutoCorrectOptions] = useState<AutoCorrectOptions>(loadAutoCorrect);
  const [autoCorrectOpen, setAutoCorrectOpen] = useState(false);
  const [wordCountOpen, setWordCountOpen] = useState(false);

  // Uma tecla digitada chega como um text.insert de um caractere (sozinho ou
  // depois de apagar a seleção). A correção vai num comando próprio: Ctrl+Z
  // logo depois desfaz só ela, como no Word.
  afterEdit.current = (command, after) => {
    if (command === correctionRef.current) return;
    const typed = command.type === "batch" ? command.commands[command.commands.length - 1] : command;
    const previous = typedEnd.current;
    typedEnd.current = null;
    if (typed?.type !== "text.insert" || [...typed.text].length !== 1 || !after.blocks[typed.block]) return;
    const block = typed.block;
    const end = typed.offset + typed.text.length;
    typedEnd.current = { block, offset: end };
    const wordTyped = previous?.block === block && previous.offset === typed.offset;
    const fix = autoCorrect(blockText(after.blocks[block]), end, typed.text, autoCorrectOptions, wordTyped);
    if (!fix) return;
    const at = { block, start: fix.start, end: fix.end };
    pendingFixes.current.push(at);
    run((doc, sel) => {
      pendingFixes.current = pendingFixes.current.filter((f) => f !== at);
      if (!doc.blocks[block] || blockText(doc.blocks[block]).slice(at.start, at.end) !== fix.from) return null;
      const delta = fix.text.length - (at.end - at.start);
      const shift = (p: Pos) => (p.block === block && p.offset >= at.end ? { block, offset: p.offset + delta } : p);
      if (typedEnd.current) typedEnd.current = shift(typedEnd.current);
      for (const f of pendingFixes.current) {
        if (f.block === block && f.start >= at.end) {
          f.start += delta;
          f.end += delta;
        }
      }
      correctionRef.current = replaceMatch(doc, at, fix.text);
      return { command: correctionRef.current, selection: { anchor: shift(sel.anchor), focus: shift(sel.focus) } };
    });
  };

  const saveAutoCorrect = (options: AutoCorrectOptions) => {
    setAutoCorrectOptions(options);
    storeAutoCorrect(options);
    setAutoCorrectOpen(false);
    focusEditor();
  };

  const closeSpellPane = () => {
    setSpellPane(null);
    focusEditor();
  };

  const changeEverywhere = (word: string, replacement: string) =>
    run((doc, sel) => ({ command: replaceAll(doc, word, replacement, { matchCase: true, wholeWord: true }).command, selection: sel }));

  const rememberWord = (action: "add" | "ignore", word: string) => {
    closeSpellMenu();
    if (proofing === "off") return;
    (action === "add" ? api.spellAddWord(proofing, word) : api.spellIgnoreAll(proofing, word)).then(spelling.recheck, showError);
  };

  // ---------- Arquivo ----------

  const undo = useCallback(() => runCommand({ type: "history.undo" }), [runCommand]);
  const redo = useCallback(() => runCommand({ type: "history.redo" }), [runCommand]);

  // Operações de arquivo esperam as edições em andamento terminarem.
  const afterQueue = useCallback(
    (task: () => Promise<void>) => {
      queue.current = queue.current.then(() => task().catch(showError));
    },
    [showError],
  );

  const formatName = (f: FileFormat) => tRef.current(`fmt.${f}` as MessageKey);

  /** Filtros da janela Salvar: o formato escolhido primeiro (o padrão é o do Word). */
  const saveFilters = (first: FileFormat) =>
    [first, ...SAVE_FORMATS.filter((f) => f !== first)].map((f) => ({ name: `${formatName(f)} (*.${f})`, extensions: [f] }));

  const openFilters = () => {
    const readable = SAVE_FORMATS.filter((f) => f !== "html");
    return [
      { name: `${tRef.current("fmt.all")} (${readable.map((f) => `*.${f}`).join(";")})`, extensions: readable },
      ...readable.map((f) => ({ name: `${formatName(f)} (*.${f})`, extensions: [f] })),
      { name: tRef.current("fmt.any"), extensions: ["*"] },
    ];
  };

  const closeBackstage = useCallback(() => {
    setBackstage(null);
    setStartup(false);
    setTimeout(focusEditor, 0);
  }, [focusEditor]);

  /** Salva no arquivo atual ou pergunta onde (Salvar como). Devolve se salvou. */
  const doSave = async (as: boolean, format?: FileFormat): Promise<boolean> => {
    const current = stateRef.current;
    if (!current) return false;
    let path: string | null = null;
    if (as || !current.view.path) {
      const chosen = format ?? current.view.format ?? "docx";
      path = await save({ filters: saveFilters(chosen), defaultPath: `${current.view.title}.${chosen}` });
      if (!path) return false;
    }
    const view = await api.saveDocument(path);
    const latest = stateRef.current ?? current;
    commit({ ...latest, view, revision: latest.revision + 1 });
    setStatus(
      view.format && LOSSY.includes(view.format)
        ? tRef.current("status.lossy", { format: formatName(view.format) })
        : tRef.current("status.savedTo", { path: view.path ?? "" }),
    );
    refreshRecents();
    return true;
  };

  /** "Deseja salvar as alterações?" antes de trocar ou fechar o documento. Devolve se pode seguir. */
  const confirmLeave = async (keepRecovery = false): Promise<boolean> => {
    const current = stateRef.current;
    if (!current?.view.dirty) return true;
    const choice = await new Promise<SaveChoice>((resolve) => setSaveAsk({ title: current.view.title, resolve }));
    setSaveAsk(null);
    if (choice === "cancel") return false;
    if (choice === "discard") {
      if (!keepRecovery) await api.discardRecovery().catch(() => {});
      return true;
    }
    return doSave(false);
  };

  const newDocument = () =>
    afterQueue(async () => {
      if (!(await confirmLeave())) return;
      loadView(await api.newDocument());
      // O núcleo descarta a cópia de recuperação ao trocar de documento.
      setRecovery(null);
      closeBackstage();
    });

  const openPath = (path: string) =>
    afterQueue(async () => {
      if (!(await confirmLeave())) return;
      try {
        loadView(await api.openDocument(path));
        setRecovery(null);
        closeBackstage();
      } finally {
        refreshRecents();
      }
    });

  const browse = () =>
    afterQueue(async () => {
      const path = await open({ multiple: false, directory: false, filters: openFilters() });
      if (path) openPath(path);
    });

  const saveDocument = (as: boolean, format?: FileFormat) =>
    afterQueue(async () => {
      if (await doSave(as, format)) closeBackstage();
    });

  const exportAs = (format: FileFormat) =>
    afterQueue(async () => {
      const current = stateRef.current;
      if (!current) return;
      const path = await save({ filters: saveFilters(format), defaultPath: `${current.view.title}.${format}` });
      if (!path) return;
      await api.exportDocument(path);
      setStatus(tRef.current("status.exportedTo", { path }));
      closeBackstage();
    });

  /** Imprimir e PDF usam a janela de impressão do sistema; o CSS de impressão mostra só a página. */
  const printDocument = () => {
    setBackstage(null);
    setStartup(false);
    setTimeout(() => window.print(), 50);
  };

  /** Fechar: o documento sai e volta a tela inicial, como no Word sem documentos abertos. */
  const closeDocument = () =>
    afterQueue(async () => {
      if (!(await confirmLeave())) return;
      loadView(await api.newDocument());
      setRecovery(null);
      setStartup(true);
      setBackstage("home");
    });

  const recoverDocument = () =>
    afterQueue(async () => {
      if (!(await confirmLeave(true))) return;
      loadView(await api.recover());
      setRecovery(null);
      closeBackstage();
    });

  const discardRecovery = () =>
    afterQueue(async () => {
      await api.discardRecovery();
      setRecovery(null);
    });

  // Recuperação automática: guarda uma cópia do documento não salvo a cada minuto.
  // Enquanto há uma cópia antiga esperando decisão, não grava por cima dela.
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (recoveryRef.current) return;
      queue.current = queue.current.then(() => api.autosave().then(() => {}, () => {}));
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, []);

  // Fechar a janela pergunta se salva as alterações, como no Word.
  const leaveRef = useRef(confirmLeave);
  leaveRef.current = confirmLeave;
  useEffect(() => {
    const win = getCurrentWindow();
    let closing = false;
    const unlisten = win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (closing) return;
      closing = true;
      await queue.current;
      if (await leaveRef.current().catch(() => false)) {
        if (!stateRef.current?.view.dirty) await api.discardRecovery().catch(() => {});
        await win.destroy();
      }
      closing = false;
    });
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  // ---------- Atualizações ----------

  const updates = useUpdates();
  const [releaseNotes, setReleaseNotes] = useState(false);

  /** Com o instalador baixado e conferido: "Salvar alterações?", roda o instalador e o app fecha. */
  const installUpdate = () =>
    afterQueue(async () => {
      if (!(await confirmLeave())) return;
      await updateApi.install();
    });

  /** Windows: baixa e instala pelo app. macOS e Linux: abre a página da release. */
  const downloadUpdate = () => {
    setReleaseNotes(false);
    const info = updates.found;
    if (!info) return;
    if (!info.canInstall) {
      openUrl(info.pageUrl).catch(showError);
      return;
    }
    updates.download(installUpdate);
  };

  // ---------- Exibir ----------

  const [zoom, setZoomValue] = useState(1);
  const [ruler, setRuler] = useState(() => load(RULER_KEY) === "on");
  const [navigation, setNavigation] = useState(() => load(NAVIGATION_KEY) === "on");
  const [focusMode, setFocusMode] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** Ponto da janela que fica parado ao mudar o zoom (o mouse, ou o centro). */
  const zoomAnchor = useRef<{ x: number; y: number; top: number; left: number; from: number } | null>(null);

  const setZoom = useCallback((next: number, at?: { x: number; y: number }) => {
    const el = scrollerRef.current;
    if (el && next !== zoomRef.current) {
      const point = at ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      zoomAnchor.current = { ...point, top: el.scrollTop, left: el.scrollLeft, from: zoomRef.current };
    }
    setZoomValue(next);
  }, []);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const el = scrollerRef.current;
    zoomAnchor.current = null;
    if (!anchor || !el) return;
    const k = zoom / anchor.from;
    el.scrollTop = (anchor.top + anchor.y) * k - anchor.y;
    el.scrollLeft = (anchor.left + anchor.x) * k - anchor.x;
  }, [zoom]);

  /** Uma Página e Largura da Página: o espaço do papel é a janela menos o espaçamento e a régua. */
  const fitZoom = useCallback(
    (fit: ZoomFit) => {
      const el = scrollerRef.current;
      const page = stateRef.current?.view.page;
      if (!el || !page) return;
      const css = getComputedStyle(el);
      const ruler = el.querySelector<HTMLElement>(".ruler-track")?.offsetHeight ?? 0;
      const viewport = {
        width: el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
        height: el.clientHeight - parseFloat(css.paddingTop) - ruler - 16,
      };
      setZoom(fit === "page" ? fitPage(page, viewport) : fitWidth(page, viewport));
    },
    [setZoom],
  );

  // Ctrl + roda do mouse, como no Word (no lugar do zoom da página inteira do WebView).
  const ready = !!state;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setZoom(stepZoom(zoomRef.current, e.deltaY < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ready, setZoom]);

  const showRuler = (on: boolean) => {
    setRuler(on);
    store(RULER_KEY, on ? "on" : "off");
  };

  const showNavigation = (on: boolean) => {
    setNavigation(on);
    store(NAVIGATION_KEY, on ? "on" : "off");
    if (!on) focusEditor();
  };

  /** Painel de Navegação: o cursor vai para o começo do título, que sobe para o alto da janela. */
  const goToHeading = (block: number) => {
    focusEditor();
    run(() => ({ command: null, selection: caret({ block, offset: 0 }) }));
    queue.current = queue.current.then(() => {
      requestAnimationFrame(() => document.querySelector(`.page [data-block="${block}"]`)?.scrollIntoView({ block: "start" }));
    });
  };

  // Modo de Foco: tela inteira só com o documento; Esc volta (se não houver caixa aberta).
  const exitFocus = useCallback(() => {
    setFocusMode(false);
    getCurrentWindow().setFullscreen(false).catch(() => {});
  }, []);
  const enterFocus = () => {
    setFocusMode(true);
    getCurrentWindow().setFullscreen(true).catch(() => {});
    setTimeout(focusEditor, 0);
  };
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".modal-backdrop, .backstage, .popover")) return;
      exitFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, exitFocus]);

  const onCommand = (command: RibbonCommand) => {
    switch (command) {
      case "file.new":
        return newDocument();
      case "file.open":
        return setBackstage("open");
      case "file.save":
        return saveDocument(false);
      case "file.saveAs":
        return setBackstage("saveAs");
      case "file.print":
        return setBackstage("print");
      case "table.insertAbove":
      case "table.insertBelow":
        focusEditor();
        return run((doc, sel) => insertRow(doc, sel, command === "table.insertBelow"));
      case "table.insertLeft":
      case "table.insertRight":
        focusEditor();
        return run((doc, sel) => insertColumn(doc, sel, command === "table.insertRight"));
      case "table.deleteRows":
        focusEditor();
        return run(deleteRows);
      case "table.deleteColumns":
        focusEditor();
        return run(deleteColumns);
      case "table.deleteTable":
        focusEditor();
        return run(deleteTable);
      case "insert.picture":
        return insertPicture();
      case "image.size25":
        return sizeImage(25);
      case "image.size50":
        return sizeImage(50);
      case "image.size75":
        return sizeImage(75);
      case "image.size100":
        return sizeImage(100);
      case "image.delete":
        focusEditor();
        return run((_doc, sel) => ({ command: setImage(sel.focus.block, null), selection: sel }));
      case "insert.pageBreak":
        focusEditor();
        return run(insertPageBreak);
      case "insert.link":
        return openLinkDialog();
      case "insert.dateTime":
        return setDateDialog(true);
      case "insert.date":
        return insertTextAtCaret(dateTimeFormats(new Date(), locale)[0]);
      case "insert.time": {
        const now = new Date();
        return insertTextAtCaret(new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now));
      }
      case "edit.undo":
        return undo();
      case "edit.redo":
        return redo();
      case "edit.cut":
      case "edit.copy":
        focusEditor();
        // Dispara os eventos copy/cut do Editor, que gravam os três formatos.
        document.execCommand(command === "edit.cut" ? "cut" : "copy");
        return;
      case "edit.paste":
        return pasteFromRibbon("keep");
      case "edit.pasteText":
        return pasteFromRibbon("text");
      case "edit.selectAll":
        focusEditor();
        return run((doc) => {
          const last = doc.blocks.length - 1;
          return { command: null, selection: { anchor: { block: 0, offset: 0 }, focus: { block: last, offset: blockText(doc.blocks[last]).length } } };
        });
      case "edit.find":
        return openFind("find");
      case "edit.replace":
        return openFind("replace");
      case "format.bold":
      case "format.italic":
      case "format.underline":
      case "format.strike":
        return onToggleMark(command.slice("format.".length) as ToggleMark);
      case "format.subscript":
        return onVertAlign("subscript");
      case "format.superscript":
        return onVertAlign("superscript");
      case "format.clear":
        return applyCharFormat(
          (doc, sel) => removeMarks(doc, sel, "all"),
          () => [],
        );
      case "format.grow":
      case "format.shrink":
        return applyCharFormat(
          (doc, sel) => growFont(doc, sel, command === "format.grow" ? 1 : -1),
          (current) => {
            const { view, selection } = stateRef.current!;
            const size = effectiveSize(current, view.blocks[selection.focus.block].style);
            const next = stepSize(size, command === "format.grow" ? 1 : -1);
            return replaceKind(current, "fontSize", { mark: "fontSize", halfPoints: Math.round(next * 2) });
          },
        );
      case "format.case":
        return onCase("cycle");
      case "format.painter":
        return onPainter(false);
      case "format.copyFormat": {
        const current = stateRef.current;
        if (current) formatClipboard.current = marksForPainter(current.view, current.selection);
        return;
      }
      case "format.pasteFormat":
        if (formatClipboard.current) applyMarks(formatClipboard.current);
        return;
      case "para.alignLeft":
        return onParaAttr({ attr: "align", value: "left" });
      case "para.alignCenter":
        return onParaAttr({ attr: "align", value: "center" });
      case "para.alignRight":
        return onParaAttr({ attr: "align", value: "right" });
      case "para.justify":
        return onParaAttr({ attr: "align", value: "justify" });
      case "para.bullets":
      case "para.numbering":
        return run((doc, sel) => ({ command: toggleList(doc, sel, command === "para.bullets" ? "bullet" : "number"), selection: sel }));
      case "para.indent":
      case "para.outdent":
        return run((doc, sel) => ({ command: changeIndent(doc, sel, command === "para.indent" ? 1 : -1), selection: sel }));
      case "para.spacing1":
        return onParaAttr({ attr: "lineSpacing", value: null });
      case "para.spacing15":
        return onParaAttr({ attr: "lineSpacing", value: 150 });
      case "para.spacing2":
        return onParaAttr({ attr: "lineSpacing", value: 200 });
      case "para.showMarks":
        return setShowMarks((s) => !s);
      case "review.spelling":
        return openSpellPane();
      case "review.autocorrect":
        return setAutoCorrectOpen(true);
      case "review.wordCount":
        return setWordCountOpen(true);
      case "review.newComment": {
        const { view: doc, selection: sel } = stateRef.current!;
        const target = commentTarget(doc, sel);
        if (!target) return setStatus(t("cm.noText"));
        if (!showComments) {
          setShowComments(true);
          store("nova.showComments", "1");
        }
        return setCmPending({ target });
      }
      case "review.deleteComment": {
        const id = cmActive ?? commentAt(stateRef.current!.view, stateRef.current!.selection.focus);
        if (id) commentHandlers.onDelete(stateRef.current!.view.comments[id]?.parent ?? id);
        return;
      }
      case "review.deleteAllComments":
        setCmActive(null);
        return run((doc, sel) => deleteAllComments(doc, sel));
      case "review.prevComment":
      case "review.nextComment": {
        const found = nextComment(stateRef.current!.view, stateRef.current!.selection, command === "review.prevComment");
        if (!found) return setStatus(t("cm.noMore"));
        run(() => found.edit);
        return;
      }
      case "review.showComments":
        setShowComments((v) => {
          store("nova.showComments", v ? "0" : "1");
          return !v;
        });
        return;
      case "references.footnote": {
        const id = newFootnoteId();
        run((_doc, sel) => insertFootnote(sel, id));
        return setFootnoteFocus(id);
      }
      case "references.nextFootnote":
        return run((doc, sel) => nextFootnote(doc, sel) ?? { command: null, selection: sel });
      default:
        return onStyle(command.slice("style.".length) as BlockStyle);
    }
  };

  // Atalhos de arquivo e de painéis valem na janela toda; os de edição o editor trata antes.
  const saveAskRef = useRef(saveAsk);
  saveAskRef.current = saveAsk;
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = matchShortcut(e, profile);
      if (!command) return;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      const history = (command === "edit.undo" || command === "edit.redo") && !inField;
      const global = command.startsWith("file.") || command === "edit.find" || command === "edit.replace" || history;
      if (!global || e.defaultPrevented || saveAskRef.current) return;
      e.preventDefault();
      commandRef.current(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [profile]);

  useReviewShortcuts(profile, onCommand);

  const highlights = useMemo(
    () => ({ all: find ? matches : [], current: find && find.current >= 0 ? matches[find.current] ?? null : null }),
    [find, matches],
  );

  if (!state) return <div className="loading">{t("app.loading")}</div>;

  const { view, selection } = state;
  const atCaret = pendingMarks ?? marksAt(view, selection.focus);
  const target = formatTarget(view, selection) ?? selection;
  const collapsedNoWord = isCollapsed(selection) && !formatTarget(view, selection);
  const active = (kind: ToggleMark) =>
    collapsedNoWord ? atCaret.some((m) => m.mark === kind) : markActive(view, target, kind);
  const vert = commonMark(view, target, "vertAlign", atCaret);
  const family = commonMark(view, target, "fontFamily", atCaret);
  const blockStyle = view.blocks[selection.focus.block]?.style ?? "paragraph";
  const sizeMark = commonMark(view, target, "fontSize", atCaret);
  const words = wordCount(view);
  const blocks = view.blocks.length;

  // Sumário: páginas dos títulos na tela (depois da paginação) e textos no idioma da interface.
  const hasToc = findToc(view.blocks) !== null;
  const tocPages = () => screenPages(document.querySelector<HTMLElement>(".page"));
  const tocLabels = { title: t("toc.title"), empty: t("toc.empty") };

  return (
    <div className={`app${painter ? " painting" : ""}${focusMode ? " focus-mode" : ""}`}>
      {backstage && (
        <Backstage
          page={backstage}
          view={view}
          recents={recents}
          recovery={recovery}
          startup={startup}
          onPage={setBackstage}
          onBack={closeBackstage}
          onNew={newDocument}
          onOpenRecent={openPath}
          onRemoveRecent={(path) => api.removeRecent(path).then(refreshRecents, showError)}
          onBrowse={browse}
          onSave={() => saveDocument(false)}
          onSaveAs={(format) => saveDocument(true, format)}
          onPrint={printDocument}
          onExport={exportAs}
          onClose={closeDocument}
          onRecover={recoverDocument}
          onDiscardRecovery={discardRecovery}
          about={<AboutPage updates={updates} onNotes={() => setReleaseNotes(true)} onDownload={downloadUpdate} />}
        />
      )}
      {releaseNotes && updates.found && (
        <ReleaseNotesDialog info={updates.found} onLink={openLink} onDownload={downloadUpdate} onClose={() => setReleaseNotes(false)} />
      )}
      {saveAsk && <SaveChangesDialog title={saveAsk.title} onChoose={saveAsk.resolve} />}
      {linkRequest && <LinkDialog request={linkRequest} onApply={applyLink} onRemove={removeLink} onClose={closeLinkDialog} />}
      {marginsDialog && (
        <MarginsDialog
          page={view.page}
          onClose={() => setMarginsDialog(false)}
          onApply={(page) => {
            setMarginsDialog(false);
            setPage(page);
          }}
        />
      )}
      {dateDialog && (
        <DateTimeDialog
          onClose={() => {
            setDateDialog(false);
            setTimeout(focusEditor, 0);
          }}
          onInsert={(text) => {
            setDateDialog(false);
            insertTextAtCaret(text);
          }}
        />
      )}
      <Ribbon
        title={view.title}
        format={view.format}
        dirty={view.dirty}
        canUndo={view.canUndo}
        canRedo={view.canRedo}
        style={blockStyle}
        font={family === undefined ? undefined : family?.value ?? DEFAULT_FONT}
        size={sizeMark === undefined ? undefined : sizeMark ? sizeMark.halfPoints / 2 : effectiveSize([], blockStyle)}
        active={{
          bold: active("bold"),
          italic: active("italic"),
          underline: active("underline"),
          strike: active("strike"),
          subscript: vert?.value === "subscript",
          superscript: vert?.value === "superscript",
        }}
        align={commonAttr(view, selection, "align")}
        list={commonAttr(view, selection, "list")}
        lineSpacing={commonAttr(view, selection, "lineSpacing")}
        showMarks={showMarks}
        painter={painter ? (painter.sticky ? "sticky" : "once") : "off"}
        fontColor={lastFontColor}
        shading={lastShading}
        onShading={(color) => {
          if (color) setLastShading(color);
          onParaAttr({ attr: "shading", value: color });
        }}
        highlight={lastHighlight}
        theme={theme}
        profile={profile}
        onCommand={onCommand}
        onBackstage={(page) => {
          refreshRecents();
          setBackstage(page);
        }}
        onStyle={onStyle}
        onTheme={setTheme}
        onFont={(font) => {
          focusEditor();
          if (font) onValueMark("fontFamily", font === DEFAULT_FONT ? null : { mark: "fontFamily", value: font });
        }}
        onSize={(pt) => {
          focusEditor();
          if (pt) onValueMark("fontSize", { mark: "fontSize", halfPoints: pt * 2 });
        }}
        onFontColor={(color) => {
          if (color) setLastFontColor(color);
          onValueMark("color", color ? { mark: "color", value: color } : null);
        }}
        onHighlight={(color) => {
          if (color) setLastHighlight(color);
          onValueMark("highlight", color ? { mark: "highlight", value: color } : null);
        }}
        onCase={onCase}
        onLineSpacing={(p) => onParaAttr({ attr: "lineSpacing", value: p === 100 ? null : p })}
        onParaSpace={(side, add) =>
          onParaAttr({ attr: side === "before" ? "spaceBefore" : "spaceAfter", value: add ? PARAGRAPH_SPACE : 0 })
        }
        onPaste={pasteFromRibbon}
        onPainter={onPainter}
        onInsertText={insertTextAtCaret}
        onInsertTable={(rows, cols) => {
          focusEditor();
          run((doc, sel) => insertTable(doc, sel, rows, cols));
        }}
        inTable={!!view.blocks[selection.focus.block]?.attrs.cell}
        onImage={!!view.blocks[selection.focus.block]?.attrs.image}
        hfEditing={hfEditing?.part ?? null}
        headerFooter={hfDraft ?? view.headerFooter}
        onEditHeaderFooter={(part) => editHeaderFooter(part)}
        onCloseHeaderFooter={closeHeaderFooter}
        onPageNumber={pageNumberAt}
        onRemovePageNumbers={removePageNumbers}
        onHeaderFooterAlign={(align) => hfEditing && updateHeaderFooter((hf) => ({ ...hf, [hfEditing.part]: { ...hf[hfEditing.part], align } }))}
        onDifferentFirst={() => {
          const on = !(hfDraftRef.current ?? view.headerFooter).differentFirst;
          updateHeaderFooter((hf) => ({ ...hf, differentFirst: on }));
          // A primeira página fica vazia: a edição passa para a segunda.
          if (on && hfEditing?.page === 0 && pageInfo.pages > 1) setHfEditing({ ...hfEditing, page: 1 });
        }}
        onInsertField={(field) => insertFieldAtCaret(field, t(field === PAGE_FIELD ? "hf.pageField" : "hf.pagesField"))}
        page={view.page}
        onPage={setPage}
        onCustomMargins={() => setMarginsDialog(true)}
        review={<ReviewTab proofing={proofing} profile={profile} onProofing={chooseProofing} onCommand={onCommand} showComments={showComments} hasComments={Object.keys(view.comments).length > 0} />}
        design={
          <DesignTab
            page={view.page}
            watermark={view.watermark ?? null}
            onPage={setPage}
            onWatermark={(value) => {
              focusEditor();
              runCommand({ type: "watermark.set", value });
            }}
          />
        }
        references={
          <ReferencesTab
            hasToc={hasToc}
            onInsertToc={() => run((doc, sel) => insertToc(doc, sel, tocPages(), tocLabels))}
            onUpdateToc={() => run((doc, sel) => updateToc(doc, sel, tocPages(), tocLabels))}
            onRemoveToc={() => run((doc, sel) => removeToc(doc, sel))}
            onCommand={onCommand}
            profile={profile}
          />
        }
        viewTab={
          <ViewTab
            zoom={zoom}
            ruler={ruler}
            navigation={navigation}
            onZoom={(z) => setZoom(z)}
            onFit={fitZoom}
            onRuler={showRuler}
            onNavigation={showNavigation}
            onFocusMode={enterFocus}
          />
        }
      />
      <UpdateBar updates={updates} onNotes={() => setReleaseNotes(true)} onDownload={downloadUpdate} onInstall={installUpdate} />
      <main className={`workspace${find ? " with-panel" : ""}`}>
        {navigation && (
          <NavigationPane headings={listHeadings(view)} caretBlock={selection.focus.block} onGo={goToHeading} onClose={() => showNavigation(false)} />
        )}
        {find && (
          <FindPanel
            state={find}
            doc={view}
            onChange={(next) => setFind((f) => (f ? { ...f, ...next } : f))}
            onGo={goToMatch}
            onReplace={replaceCurrent}
            onReplaceAll={replaceEverything}
            onClose={() => {
              setFind(null);
              focusEditor();
            }}
          />
        )}
        <div className="scroller" ref={scrollerRef} style={{ "--zoom": zoom } as CSSProperties} data-zoomed={zoom !== 1 || undefined}>
          {ruler && <Ruler page={view.page} zoom={zoom} />}
          <Editor
            view={view}
            revision={state.revision}
            selection={selection}
            pendingMarks={pendingMarks}
            profile={profile}
            showMarks={showMarks}
            highlights={highlights}
            misspelled={spelling.painted}
            onContextMenu={onContextMenu}
            onEdit={run}
            onSelect={onSelect}
            onCommand={onCommand}
            onPointerUp={onPointerUp}
            onOpenLink={openLink}
            onPageInfo={(info) => setPageInfo((p) => (p.pages === info.pages && p.current === info.current ? p : info))}
            headerFooter={hfDraft ?? view.headerFooter}
            hfEditing={hfEditing}
            onHfEdit={editHeaderFooter}
            onHfChange={(part, value) => setHfDraft((d) => ({ ...(d ?? view.headerFooter), [part]: value }))}
            onHfClose={closeHeaderFooter}
            footnoteFocus={footnoteFocus}
            onFootnoteFocused={() => setFootnoteFocus(null)}
            onFootnoteChange={(id, text) => run((_doc, sel) => ({ command: { type: "footnote.set", id, text }, selection: sel }))}
            onFootnoteDone={() => document.querySelector<HTMLElement>(".page")?.focus()}
            showComments={showComments}
            comments={commentHandlers}
            onPasteImage={pasteImage}
            onEscape={() => {
              if (painter) setPainter(null);
              else if (find) setFind(null);
            }}
          />
        </div>
        {wordCountOpen && (
          <WordCountDialog
            view={view}
            selection={selection}
            pages={pageInfo.pages}
            onClose={() => {
              setWordCountOpen(false);
              focusEditor();
            }}
          />
        )}
        {autoCorrectOpen && (
          <AutoCorrectDialog
            options={autoCorrectOptions}
            onSave={saveAutoCorrect}
            onClose={() => {
              setAutoCorrectOpen(false);
              focusEditor();
            }}
          />
        )}
        {spellPane && (
          <SpellingPane
            view={view}
            matches={spelling.all}
            ready={spelling.ready}
            proofing={proofing}
            start={spellPane.start}
            token={spellPane.token}
            onSelect={(m) => run(() => ({ command: null, selection: matchSelection(m) }))}
            onChange={replaceWord}
            onChangeAll={changeEverywhere}
            onRecheck={spelling.recheck}
            onError={showError}
            onClose={closeSpellPane}
          />
        )}
      </main>
      <footer className="statusbar">
        <span>{t("status.page", pageInfo)}</span>
        <span>{t(`style.${blockStyle}`)}</span>
        <span>
          {words === 1 ? t("status.word") : t("status.words", { words })} ·{" "}
          {blocks === 1 ? t("status.paragraph") : t("status.paragraphs", { blocks })}
        </span>
        <select
          className="proofing"
          aria-label={t("spell.language")}
          title={t("spell.language")}
          value={proofing}
          onChange={(e) => chooseProofing(e.target.value as Proofing)}
        >
          {SPELL_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {t(`spell.lang.${language}`)}
            </option>
          ))}
          <option value="off">{t("spell.off")}</option>
        </select>
        <span className="status">
          {painter
            ? t(painter.sticky ? "status.painterSticky" : "status.painter")
            : status || (view.dirty ? t("status.unsaved") : view.path ? t("status.saved") : "")}
        </span>
        <ZoomControl zoom={zoom} onZoom={(z) => setZoom(z)} onFit={fitZoom} onStep={(d) => setZoom(stepZoom(zoom, d))} />
      </footer>
      {focusMode && (
        <button className="focus-exit" onClick={exitFocus} title={t("view.focusExit")}>
          {t("view.focusExit")}
        </button>
      )}
      {spellMenu && proofing !== "off" && (
        <SpellMenu
          word={spellMenu.word}
          language={proofing}
          x={spellMenu.x}
          y={spellMenu.y}
          onPick={(s) => pickSuggestion(spellMenu.match, spellMenu.word, s)}
          onIgnoreAll={() => rememberWord("ignore", spellMenu.word)}
          onAdd={() => rememberWord("add", spellMenu.word)}
          onClose={closeSpellMenu}
        />
      )}
    </div>
  );
}

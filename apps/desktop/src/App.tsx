import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { insertFragment, NOVA_MIME, parseHtml, plainFragment, type Fragment } from "./clipboard";
import { writeSelection } from "./dom";
import { Editor, type EditFn } from "./Editor";
import { matchSelection, nextMatch, replaceAll, replaceMatch } from "./find";
import { FindPanel, useMatches, type FindState } from "./FindPanel";
import {
  changeCase,
  changeIndent,
  commonAttr,
  commonMark,
  DEFAULT_FONT,
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
import { useI18n } from "./i18n";
import {
  blockText,
  caret,
  clampSelection,
  comparePos,
  firstDifference,
  isCollapsed,
  markActive,
  marksAt,
  ordered,
  setStyle,
  toggleMark,
  toggledMarks,
  wordCount,
  type Selection,
} from "./model";
import { Ribbon, type RibbonCommand } from "./Ribbon";
import { matchShortcut, profileFor } from "./shortcuts";
import { useTheme } from "./theme";
import { applyPatch, type BlockStyle, type DocView, type HighlightColor, type Mark, type MarkKind, type ParaAttr, type TextCommand, type ToggleMark } from "./types";

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

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [pendingMarks, setPendingMarks] = useState<Mark[] | null>(null);
  const [status, setStatus] = useState("");
  const [showMarks, setShowMarks] = useState(false);
  const [painter, setPainter] = useState<{ marks: Mark[]; sticky: boolean } | null>(null);
  const [lastFontColor, setLastFontColor] = useState("#C00000");
  const [lastHighlight, setLastHighlight] = useState<HighlightColor>("yellow");
  const [find, setFind] = useState<FindState | null>(null);
  const { t, locale } = useI18n();
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

  useEffect(() => {
    api.snapshot().then(loadView, showError);
  }, [loadView, showError]);

  // Título da janela: nome do arquivo e um ponto quando há alterações não salvas.
  useEffect(() => {
    if (!state) return;
    const title = `${state.view.dirty ? "● " : ""}${state.view.title} — NovaOffice`;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [state?.view.title, state?.view.dirty]);

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

  const matches = useMatches(state?.view ?? { blocks: [], canUndo: false, canRedo: false, path: null, title: "", dirty: false }, find);

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

  const filters = () => [{ name: t("filter.nova"), extensions: ["nova"] }];

  const confirmDiscard = async () =>
    !stateRef.current?.view.dirty ||
    (await ask(t("dialog.discard"), {
      title: "NovaOffice",
      kind: "warning",
    }));

  const newDocument = () =>
    afterQueue(async () => {
      if (await confirmDiscard()) loadView(await api.newDocument());
    });

  const openDocument = () =>
    afterQueue(async () => {
      if (!(await confirmDiscard())) return;
      const path = await open({
        multiple: false,
        directory: false,
        filters: [...filters(), { name: t("filter.text"), extensions: ["txt", "md"] }],
      });
      if (path) loadView(await api.openDocument(path));
    });

  const saveDocument = (as: boolean) =>
    afterQueue(async () => {
      const current = stateRef.current;
      if (!current) return;
      let path: string | null = null;
      if (as || !current.view.path) {
        path = await save({ filters: filters(), defaultPath: `${current.view.title}.nova` });
        if (!path) return;
      }
      const view = await api.saveDocument(path);
      commit({ ...current, view, revision: current.revision + 1 });
      setStatus(t("status.savedTo", { path: view.path ?? "" }));
    });

  const exportMarkdown = () =>
    afterQueue(async () => {
      const current = stateRef.current;
      if (!current) return;
      const path = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: `${current.view.title}.md`,
      });
      if (!path) return;
      await api.exportMarkdown(path);
      setStatus(t("status.exportedTo", { path }));
    });

  const onCommand = (command: RibbonCommand) => {
    switch (command) {
      case "file.new":
        return newDocument();
      case "file.open":
        return openDocument();
      case "file.save":
        return saveDocument(false);
      case "file.saveAs":
        return saveDocument(true);
      case "file.exportMarkdown":
        return exportMarkdown();
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
      default:
        return onStyle(command.slice("style.".length) as BlockStyle);
    }
  };

  // Atalhos de arquivo e de painéis valem na janela toda; os de edição o editor trata antes.
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = matchShortcut(e, profile);
      if (!command) return;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      const history = (command === "edit.undo" || command === "edit.redo") && !inField;
      const global = command.startsWith("file.") || command === "edit.find" || command === "edit.replace" || history;
      if (!global || e.defaultPrevented) return;
      e.preventDefault();
      commandRef.current(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [profile]);

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

  return (
    <div className={`app${painter ? " painting" : ""}`}>
      <Ribbon
        title={view.title}
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
        highlight={lastHighlight}
        theme={theme}
        profile={profile}
        onCommand={onCommand}
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
      />
      <main className={`workspace${find ? " with-panel" : ""}`}>
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
        <div className="scroller">
          <Editor
            view={view}
            revision={state.revision}
            selection={selection}
            pendingMarks={pendingMarks}
            profile={profile}
            showMarks={showMarks}
            highlights={highlights}
            onEdit={run}
            onSelect={onSelect}
            onCommand={onCommand}
            onPointerUp={onPointerUp}
            onEscape={() => {
              if (painter) setPainter(null);
              else if (find) setFind(null);
            }}
          />
        </div>
      </main>
      <footer className="statusbar">
        <span>{t(`style.${blockStyle}`)}</span>
        <span>
          {words === 1 ? t("status.word") : t("status.words", { words })} ·{" "}
          {blocks === 1 ? t("status.paragraph") : t("status.paragraphs", { blocks })}
        </span>
        <span className="status">
          {painter
            ? t(painter.sticky ? "status.painterSticky" : "status.painter")
            : status || (view.dirty ? t("status.unsaved") : view.path ? t("status.saved") : "")}
        </span>
      </footer>
    </div>
  );
}

//! Estado do documento aberto na janela: sessão, arquivo e alterações não salvas.

use std::fs;
use std::path::{Path, PathBuf};

use nova_app::{file, markdown, new_client_id, Session};
use nova_domain_text::{BlockStyle, ParaAttrs, Span, TextCommand, TextDocument, TextEvent};
use serde::Serialize;

/// O que a interface precisa para desenhar o documento.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocView {
    pub blocks: Vec<BlockView>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub path: Option<String>,
    pub title: String,
    pub dirty: bool,
}

#[derive(Debug, Serialize)]
pub struct BlockView {
    pub style: BlockStyle,
    pub attrs: ParaAttrs,
    pub spans: Vec<Span>,
}

/// Resposta de um comando: só os parágrafos que mudaram, para a interface não
/// precisar receber nem redesenhar o documento inteiro a cada tecla.
#[derive(Debug, Serialize)]
pub struct DispatchResult {
    pub events: Vec<TextEvent>,
    pub patch: ViewPatch,
}

/// Troca os parágrafos `start..start + delete_count` da visão anterior por
/// `blocks` (como `Array.splice`). `block_count` confere o resultado.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewPatch {
    pub start: u32,
    pub delete_count: u32,
    pub blocks: Vec<BlockView>,
    pub block_count: u32,
    pub can_undo: bool,
    pub can_redo: bool,
    pub path: Option<String>,
    pub title: String,
    pub dirty: bool,
}

/// Faixa de parágrafos alterada, no documento atual: `[start, end)`. Cresce a
/// cada evento e acompanha os deslocamentos de inserções e remoções.
#[derive(Default)]
struct Dirty(Option<(u32, u32)>);

impl Dirty {
    fn touch(&mut self, from: u32, to: u32) {
        self.0 = Some(match self.0 {
            Some((a, b)) => (a.min(from), b.max(to)),
            None => (from, to),
        });
    }

    fn changed(&mut self, block: u32) {
        self.touch(block, block + 1);
    }

    fn inserted(&mut self, index: u32) {
        if let Some((a, b)) = &mut self.0 {
            if *a >= index {
                *a += 1;
            }
            if *b >= index {
                *b += 1;
            }
        }
        self.touch(index, index + 1);
    }

    fn removed(&mut self, index: u32) {
        if let Some((a, b)) = &mut self.0 {
            if *a > index {
                *a -= 1;
            }
            if *b > index {
                *b -= 1;
            }
        }
        // O ponto da remoção precisa ficar dentro da faixa trocada.
        self.touch(index, index);
    }
}

/// Faixa alterada a partir dos eventos, ou `None` se é preciso redesenhar tudo
/// (desfazer e refazer podem mudar qualquer parte do documento).
fn dirty_range(events: &[TextEvent]) -> Option<(u32, u32)> {
    let mut dirty = Dirty::default();
    for event in events {
        match event {
            TextEvent::TextInserted { block, .. }
            | TextEvent::TextDeleted { block, .. }
            | TextEvent::MarkApplied { block, .. }
            | TextEvent::MarkRemoved { block, .. }
            | TextEvent::BlockStyled { block, .. }
            | TextEvent::BlockAttrSet { block, .. } => dirty.changed(*block),
            TextEvent::BlockSplit { block, .. } => {
                dirty.changed(*block);
                dirty.inserted(block + 1);
            }
            TextEvent::BlocksMerged { block, .. } => {
                dirty.removed(block + 1);
                dirty.changed(*block);
            }
            TextEvent::BlockInserted { index } => dirty.inserted(*index),
            TextEvent::BlockRemoved { index, .. } => dirty.removed(*index),
            TextEvent::RangeDeleted { from, to } => {
                for _ in from.block..to.block {
                    dirty.removed(from.block + 1);
                }
                dirty.changed(from.block);
            }
            TextEvent::Undone | TextEvent::Redone => return None,
        }
    }
    Some(dirty.0.unwrap_or((0, 0)))
}

pub struct Editor {
    session: Session,
    path: Option<PathBuf>,
    dirty: bool,
}

impl Editor {
    pub fn new() -> Self {
        Self::with(TextDocument::new(new_client_id()), None)
    }

    fn with(document: TextDocument, path: Option<PathBuf>) -> Self {
        Self {
            session: Session::new(document),
            path,
            dirty: false,
        }
    }

    /// Abre um `.nova`, ou importa texto (`.txt`, `.md` e outros) como um
    /// documento novo, sem arquivo associado: salvar pede um `.nova`.
    pub fn open(path: &Path) -> Result<Self, String> {
        if is_nova(path) {
            let bytes = fs::read(path).map_err(|e| io_error("lendo", path, e))?;
            let document = file::decode(new_client_id(), &bytes)
                .map_err(|e| format!("abrindo {}: {e}", path.display()))?;
            Ok(Self::with(document, Some(path.to_path_buf())))
        } else {
            let text = fs::read_to_string(path).map_err(|e| io_error("lendo", path, e))?;
            let mut editor =
                Self::with(TextDocument::from_plain_text(new_client_id(), &text), None);
            editor.dirty = true;
            Ok(editor)
        }
    }

    pub fn dispatch(&mut self, command: TextCommand) -> Result<DispatchResult, String> {
        let before = self.session.document().block_count();
        let events = self.session.dispatch(command).map_err(|e| e.to_string())?;
        if !events.is_empty() {
            self.dirty = true;
        }
        let after = self.session.document().block_count();
        let (start, end, old_end) = match dirty_range(&events) {
            // O que vem depois da faixa não mudou; só andou `after - before` posições.
            Some((start, end)) => (start, end, end + before - after),
            None => (0, after, before),
        };
        Ok(DispatchResult {
            events,
            patch: self.patch(start, end, old_end - start),
        })
    }

    fn patch(&self, start: u32, end: u32, delete_count: u32) -> ViewPatch {
        let view = self.meta();
        ViewPatch {
            start,
            delete_count,
            blocks: (start..end).map(|i| self.block_view(i)).collect(),
            block_count: self.session.document().block_count(),
            can_undo: view.can_undo,
            can_redo: view.can_redo,
            path: view.path,
            title: view.title,
            dirty: view.dirty,
        }
    }

    fn block_view(&self, i: u32) -> BlockView {
        let doc = self.session.document();
        BlockView {
            style: doc.block_style(i).expect("índice dentro do documento"),
            attrs: doc.block_attrs(i).expect("índice dentro do documento"),
            spans: doc.block_spans(i).expect("índice dentro do documento"),
        }
    }

    /// Visão sem os parágrafos (só os metadados).
    fn meta(&self) -> DocView {
        let doc = self.session.document();
        DocView {
            blocks: Vec::new(),
            can_undo: doc.can_undo(),
            can_redo: doc.can_redo(),
            path: self.path.as_ref().map(|p| p.display().to_string()),
            title: self.path.as_ref().and_then(|p| p.file_stem()).map_or_else(
                || "Sem título".to_string(),
                |s| s.to_string_lossy().into_owned(),
            ),
            dirty: self.dirty,
        }
    }

    /// Salva no arquivo atual ou em `target`; o nome sempre termina em `.nova`.
    pub fn save(&mut self, target: Option<PathBuf>) -> Result<(), String> {
        let path = match target {
            Some(path) => with_nova_extension(path),
            None => self
                .path
                .clone()
                .ok_or("o documento ainda não tem arquivo; use Salvar como")?,
        };
        fs::write(&path, file::encode(self.session.document()))
            .map_err(|e| io_error("gravando", &path, e))?;
        self.path = Some(path);
        self.dirty = false;
        Ok(())
    }

    pub fn export_markdown(&self, path: &Path) -> Result<(), String> {
        fs::write(path, markdown::export(self.session.document()))
            .map_err(|e| io_error("gravando", path, e))
    }

    pub fn view(&self) -> DocView {
        DocView {
            blocks: (0..self.session.document().block_count())
                .map(|i| self.block_view(i))
                .collect(),
            ..self.meta()
        }
    }
}

fn is_nova(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("nova"))
}

fn with_nova_extension(path: PathBuf) -> PathBuf {
    if is_nova(&path) {
        path
    } else {
        path.with_extension("nova")
    }
}

fn io_error(action: &str, path: &Path, error: std::io::Error) -> String {
    format!("{action} {}: {error}", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::Mark;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nova-desktop-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn insert(text: &str) -> TextCommand {
        TextCommand::InsertText {
            block: 0,
            offset: 0,
            text: text.into(),
            marks: None,
        }
    }

    #[test]
    fn editar_marca_alteracao_e_salvar_limpa() {
        let dir = temp_dir("salvar");
        let mut editor = Editor::new();
        assert!(!editor.view().dirty);

        let result = editor.dispatch(insert("Olá")).unwrap();
        assert_eq!(result.events.len(), 1);
        assert!(result.patch.dirty && result.patch.can_undo);

        assert!(
            editor.save(None).is_err(),
            "sem arquivo, salvar exige um destino"
        );
        editor.save(Some(dir.join("carta.txt"))).unwrap();
        let view = editor.view();
        assert!(!view.dirty);
        assert_eq!(view.title, "carta");
        assert!(view.path.unwrap().ends_with("carta.nova"));
    }

    #[test]
    fn reabrir_preserva_conteudo_e_formatacao() {
        let dir = temp_dir("reabrir");
        let path = dir.join("doc.nova");
        let mut editor = Editor::new();
        editor.dispatch(insert("negrito")).unwrap();
        editor
            .dispatch(TextCommand::ApplyMark {
                block: 0,
                offset: 0,
                len: 7,
                mark: Mark::Bold,
            })
            .unwrap();
        editor.save(Some(path.clone())).unwrap();

        let view = Editor::open(&path).unwrap().view();
        assert_eq!(view.blocks[0].spans[0].text, "negrito");
        assert_eq!(view.blocks[0].spans[0].marks, vec![Mark::Bold]);
        assert!(!view.dirty && !view.can_undo);
    }

    #[test]
    fn importar_texto_cria_documento_sem_arquivo() {
        let dir = temp_dir("importar");
        let path = dir.join("notas.txt");
        fs::write(&path, "linha 1\nlinha 2").unwrap();

        let view = Editor::open(&path).unwrap().view();
        assert_eq!(view.blocks.len(), 2);
        assert!(view.path.is_none() && view.dirty);
    }

    #[test]
    fn comando_invalido_vira_mensagem() {
        let mut editor = Editor::new();
        let error = editor
            .dispatch(TextCommand::RemoveBlock { block: 0 })
            .unwrap_err();
        assert!(error.contains("pelo menos um bloco"));
        assert!(!editor.view().dirty);
    }

    /// Aplica o remendo na visão anterior, como a interface faz.
    fn apply(mut blocks: Vec<String>, patch: &ViewPatch) -> Vec<String> {
        let start = patch.start as usize;
        let new: Vec<String> = patch
            .blocks
            .iter()
            .map(|b| b.spans.iter().map(|s| s.text.as_str()).collect())
            .collect();
        blocks.splice(start..start + patch.delete_count as usize, new);
        assert_eq!(blocks.len(), patch.block_count as usize);
        blocks
    }

    fn texts(editor: &Editor) -> Vec<String> {
        editor
            .view()
            .blocks
            .iter()
            .map(|b| b.spans.iter().map(|s| s.text.as_str()).collect())
            .collect()
    }

    #[test]
    fn remendo_traz_so_o_que_mudou() {
        use nova_domain_text::Pos;
        let mut editor = Editor::new();
        let lines: Vec<TextCommand> = (1..10)
            .map(|i| TextCommand::InsertBlock {
                index: i,
                text: format!("p{i}"),
                style: BlockStyle::Paragraph,
            })
            .collect();
        editor
            .dispatch(TextCommand::Batch { commands: lines })
            .unwrap();

        let cases = vec![
            TextCommand::InsertText {
                block: 5,
                offset: 0,
                text: "x".into(),
                marks: None,
            },
            TextCommand::SplitBlock {
                block: 3,
                offset: 1,
            },
            TextCommand::MergeWithNext { block: 7 },
            TextCommand::DeleteRange {
                from: Pos {
                    block: 2,
                    offset: 1,
                },
                to: Pos {
                    block: 6,
                    offset: 1,
                },
            },
            TextCommand::Batch {
                commands: vec![
                    TextCommand::SplitBlock {
                        block: 1,
                        offset: 0,
                    },
                    TextCommand::InsertBlock {
                        index: 0,
                        text: "topo".into(),
                        style: BlockStyle::Paragraph,
                    },
                    TextCommand::RemoveBlock { block: 4 },
                    TextCommand::InsertText {
                        block: 3,
                        offset: 0,
                        text: "y".into(),
                        marks: None,
                    },
                ],
            },
            TextCommand::Undo,
            TextCommand::RemoveBlock { block: 0 },
        ];
        for command in cases {
            let before = texts(&editor);
            let result = editor.dispatch(command.clone()).unwrap();
            assert_eq!(apply(before, &result.patch), texts(&editor), "{command:?}");
        }

        // Digitar num documento grande manda um parágrafo só.
        let result = editor.dispatch(insert("z")).unwrap();
        assert_eq!(
            (
                result.patch.start,
                result.patch.delete_count,
                result.patch.blocks.len()
            ),
            (0, 1, 1)
        );
    }

    #[test]
    fn visao_serializa_para_a_interface() {
        let json = serde_json::to_value(Editor::new().view()).unwrap();
        assert_eq!(json["blocks"][0]["style"], "paragraph");
        assert_eq!(json["blocks"][0]["attrs"]["align"], "left");
        assert_eq!(json["blocks"][0]["attrs"]["list"], serde_json::Value::Null);
        assert_eq!(json["canUndo"], false);
        assert_eq!(json["title"], "Sem título");
    }
}

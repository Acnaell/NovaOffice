//! Estado do documento aberto na janela: sessão, arquivo e alterações não salvas.

use std::fs;
use std::path::{Path, PathBuf};

use nova_app::{file, markdown, new_client_id, Session};
use nova_domain_text::{BlockStyle, Span, TextCommand, TextDocument, TextEvent};
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
    pub spans: Vec<Span>,
}

#[derive(Debug, Serialize)]
pub struct DispatchResult {
    pub events: Vec<TextEvent>,
    pub view: DocView,
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
        let events = self.session.dispatch(command).map_err(|e| e.to_string())?;
        if !events.is_empty() {
            self.dirty = true;
        }
        Ok(DispatchResult {
            events,
            view: self.view(),
        })
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
        let doc = self.session.document();
        let blocks = (0..doc.block_count())
            .map(|i| BlockView {
                style: doc.block_style(i).expect("índice dentro do documento"),
                spans: doc.block_spans(i).expect("índice dentro do documento"),
            })
            .collect();
        DocView {
            blocks,
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
        assert!(result.view.dirty && result.view.can_undo);

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

    #[test]
    fn visao_serializa_para_a_interface() {
        let json = serde_json::to_value(Editor::new().view()).unwrap();
        assert_eq!(json["blocks"][0]["style"], "paragraph");
        assert_eq!(json["canUndo"], false);
        assert_eq!(json["title"], "Sem título");
    }
}

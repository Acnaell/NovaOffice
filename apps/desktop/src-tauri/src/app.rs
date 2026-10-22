//! Os comandos do app, sem depender do Tauri: a janela (lib.rs) e a ponte
//! de testes (e2e/bridge) chamam exatamente o mesmo código.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use nova_app::{file, formats::Format, new_client_id};
use nova_domain_text::TextCommand;
use serde_json::Value;

use crate::editor::{title_of, DispatchResult, DocView, Editor};
use crate::store::{now_ms, Recent, RecoveryInfo, Store};

pub struct App {
    editor: Mutex<Editor>,
    store: Store,
}

impl App {
    pub fn new(store_dir: PathBuf) -> Self {
        Self {
            editor: Mutex::new(Editor::new()),
            store: Store::new(store_dir),
        }
    }

    fn editor(&self) -> MutexGuard<'_, Editor> {
        // Um pânico num comando anterior não deve travar a janela.
        self.editor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn snapshot(&self) -> DocView {
        self.editor().view()
    }

    pub fn dispatch(&self, command: TextCommand) -> Result<DispatchResult, String> {
        self.editor().dispatch(command)
    }

    pub fn new_document(&self) -> DocView {
        let mut editor = self.editor();
        *editor = Editor::new();
        self.store.discard_recovery();
        editor.view()
    }

    pub fn open_document(&self, path: &str) -> Result<DocView, String> {
        let path = PathBuf::from(path);
        let opened = Editor::open(&path)?;
        if opened.path().is_some() {
            let _ = self.store.add_recent(&path, &title_of(Some(&path)));
        }
        let mut editor = self.editor();
        *editor = opened;
        self.store.discard_recovery();
        Ok(editor.view())
    }

    pub fn save_document(&self, path: Option<String>) -> Result<DocView, String> {
        let mut editor = self.editor();
        editor.save(path.map(PathBuf::from))?;
        if let Some(p) = editor.path() {
            let _ = self.store.add_recent(p, &title_of(Some(p)));
        }
        self.store.discard_recovery();
        Ok(editor.view())
    }

    pub fn export_document(&self, path: &str) -> Result<(), String> {
        self.editor().export(Path::new(path))
    }

    pub fn formats(&self) -> Value {
        Format::catalog()
    }

    pub fn recent(&self) -> Vec<Recent> {
        self.store.recent()
    }

    pub fn remove_recent(&self, path: &str) -> Result<(), String> {
        self.store.remove_recent(path)
    }

    /// Guarda uma cópia do documento se houver alterações não salvas; sem
    /// alterações, apaga a cópia. Devolve se guardou.
    pub fn autosave(&self) -> Result<bool, String> {
        let editor = self.editor();
        if !editor.is_dirty() {
            self.store.discard_recovery();
            return Ok(false);
        }
        let info = RecoveryInfo {
            title: title_of(editor.path()),
            path: editor.path().map(|p| p.display().to_string()),
            saved_at: now_ms(),
        };
        self.store.save_recovery(&editor.snapshot_bytes(), &info)?;
        Ok(true)
    }

    pub fn recovery_info(&self) -> Option<RecoveryInfo> {
        self.store.recovery().map(|(info, _)| info)
    }

    /// Abre a cópia de recuperação como documento com alterações não salvas.
    pub fn recover(&self) -> Result<DocView, String> {
        let (info, bytes) = self
            .store
            .recovery()
            .ok_or("não há documento para recuperar")?;
        let document = file::decode(new_client_id(), &bytes).map_err(|e| e.to_string())?;
        let mut editor = self.editor();
        *editor = Editor::recovered(document, info.path.map(PathBuf::from));
        Ok(editor.view())
    }

    /// Inserir → Imagens: lê o arquivo e guarda no documento.
    pub fn add_image_file(&self, path: &str) -> Result<nova_domain_text::ImageRef, String> {
        let data = std::fs::read(path).map_err(|e| format!("lendo {path}: {e}"))?;
        self.editor().add_image(&data)
    }

    /// Imagem colada (base64), da área de transferência.
    pub fn add_image_data(&self, base64: &str) -> Result<nova_domain_text::ImageRef, String> {
        let data = nova_app::media::from_base64(base64).ok_or("imagem colada inválida")?;
        self.editor().add_image(&data)
    }

    pub fn media(&self, id: &str) -> Option<String> {
        self.editor().media(id)
    }

    pub fn discard_recovery(&self) {
        self.store.discard_recovery();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn recuperar_depois_de_um_travamento() {
        let dir = std::env::temp_dir().join(format!("nova-app-rec-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let app = App::new(dir.join("store"));
        app.dispatch(TextCommand::InsertText {
            block: 0,
            offset: 0,
            text: "rascunho".into(),
            marks: None,
        })
        .unwrap();
        assert!(app.autosave().unwrap());

        // "Travou": um app novo com a mesma pasta encontra a cópia.
        let again = App::new(dir.join("store"));
        assert_eq!(again.recovery_info().unwrap().title, "Sem título");
        let view = again.recover().unwrap();
        assert!(view.dirty);
        assert_eq!(view.blocks[0].spans[0].text, "rascunho");

        // Salvar apaga a cópia e entra nos recentes.
        fs::create_dir_all(&dir).unwrap();
        again
            .save_document(Some(dir.join("rascunho").display().to_string()))
            .unwrap();
        assert!(again.recovery_info().is_none());
        assert!(again.recent()[0].path.ends_with("rascunho.docx"));
    }
}

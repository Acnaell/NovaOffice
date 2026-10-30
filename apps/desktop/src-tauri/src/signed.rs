//! Atualização assinada (plugin updater do Tauri).
//!
//! Cada release publica um `latest.json` com a assinatura (minisign) de cada
//! instalador. O app só aceita o que foi assinado com a chave da NovaOffice
//! (a pública fica no `tauri.conf.json`), baixa em segundo plano, instala e
//! reinicia: no Windows, o instalador NSIS em modo passivo; no macOS, o
//! `.app`; no Linux, só o AppImage (pacotes .deb e .rpm seguem pelo sistema).
//!
//! Releases sem `latest.json` (até a 0.1.13) caem no caminho antigo (update.rs):
//! instalador do GitHub conferido pelo `.sha256`.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::update::Progress;

#[derive(Default)]
pub struct Signed {
    update: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
}

/// O app pode se atualizar sozinho aqui? No Linux, só rodando como AppImage.
fn supported() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

impl Signed {
    /// Procura a versão `version` no `latest.json`; guarda a atualização se achar.
    pub async fn find(&self, handle: &AppHandle, version: &str) -> bool {
        *self.bytes.lock().expect("trava") = None;
        let found = if supported() {
            match handle.updater() {
                Ok(updater) => updater.check().await.ok().flatten(),
                Err(_) => None,
            }
        } else {
            None
        };
        let found = found.filter(|u| u.version.trim_start_matches('v') == version);
        let ok = found.is_some();
        *self.update.lock().expect("trava") = found;
        ok
    }

    pub fn has_update(&self) -> bool {
        self.update.lock().expect("trava").is_some()
    }

    /// Baixa o instalador e confere a assinatura; o progresso vai no evento `update-progress`.
    pub async fn download(&self, handle: &AppHandle) -> Result<(), String> {
        let update = self
            .update
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("nenhuma atualização assinada para baixar")?;
        let received = std::sync::atomic::AtomicU64::new(0);
        let emitter = handle.clone();
        let bytes = update
            .download(
                |chunk, total| {
                    let now = received
                        .fetch_add(chunk as u64, std::sync::atomic::Ordering::Relaxed)
                        + chunk as u64;
                    let _ = emitter.emit(
                        "update-progress",
                        Progress {
                            received: now,
                            total: total.unwrap_or(now),
                        },
                    );
                },
                || {},
            )
            .await
            .map_err(|e| format!("baixando a atualização: {e}"))?;
        *self.bytes.lock().map_err(|e| e.to_string())? = Some(bytes);
        Ok(())
    }

    pub fn downloaded(&self) -> bool {
        self.bytes.lock().expect("trava").is_some()
    }

    /// Instala e reinicia o app (no Windows, o instalador fecha o app sozinho).
    pub fn install(&self, handle: &AppHandle) -> Result<(), String> {
        let update = self
            .update
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("nenhuma atualização assinada")?;
        let bytes = self
            .bytes
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .ok_or("a atualização ainda não foi baixada")?;
        update
            .install(bytes)
            .map_err(|e| format!("instalando a atualização: {e}"))?;
        handle.restart()
    }
}

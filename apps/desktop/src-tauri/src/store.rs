//! O que o app guarda fora dos documentos, numa pasta própria do usuário:
//! a lista de documentos recentes e a cópia de recuperação automática.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Quantos recentes a tela Abrir mostra, como no Word.
const MAX_RECENT: usize = 25;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub path: String,
    pub title: String,
    /// Último uso, em milissegundos desde 1970.
    pub opened_at: u64,
}

/// O que a recuperação automática guardou do documento não salvo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    pub title: String,
    /// Arquivo original, se o documento já tinha sido salvo alguma vez.
    pub path: Option<String>,
    pub saved_at: u64,
}

pub struct Store {
    dir: PathBuf,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    fn write(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        // Grava num temporário e renomeia: um travamento no meio não corrompe o arquivo.
        let tmp = self.file(&format!("{name}.tmp"));
        fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
        fs::rename(&tmp, self.file(name)).map_err(|e| e.to_string())
    }

    // ---------- Recentes ----------

    /// Recentes que ainda existem, do mais novo para o mais antigo.
    pub fn recent(&self) -> Vec<Recent> {
        let list: Vec<Recent> = fs::read(self.file("recent.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        list.into_iter()
            .filter(|r| Path::new(&r.path).exists())
            .collect()
    }

    pub fn add_recent(&self, path: &Path, title: &str) -> Result<(), String> {
        let path = path.display().to_string();
        let mut list = self.recent();
        list.retain(|r| r.path != path);
        list.insert(
            0,
            Recent {
                path,
                title: title.to_string(),
                opened_at: now_ms(),
            },
        );
        list.truncate(MAX_RECENT);
        self.write(
            "recent.json",
            &serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?,
        )
    }

    pub fn remove_recent(&self, path: &str) -> Result<(), String> {
        let mut list = self.recent();
        list.retain(|r| r.path != path);
        self.write(
            "recent.json",
            &serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?,
        )
    }

    // ---------- Recuperação automática ----------

    pub fn save_recovery(&self, bytes: &[u8], info: &RecoveryInfo) -> Result<(), String> {
        self.write("recovery.nova", bytes)?;
        self.write(
            "recovery.json",
            &serde_json::to_vec(info).map_err(|e| e.to_string())?,
        )
    }

    pub fn recovery(&self) -> Option<(RecoveryInfo, Vec<u8>)> {
        let info = serde_json::from_slice(&fs::read(self.file("recovery.json")).ok()?).ok()?;
        let bytes = fs::read(self.file("recovery.nova")).ok()?;
        Some((info, bytes))
    }

    pub fn discard_recovery(&self) {
        let _ = fs::remove_file(self.file("recovery.nova"));
        let _ = fs::remove_file(self.file("recovery.json"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(name: &str) -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("nova-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (Store::new(dir.join("app")), dir)
    }

    #[test]
    fn recentes_sem_repetir_e_so_os_que_existem() {
        let (store, dir) = store("recentes");
        let a = dir.join("a.docx");
        let b = dir.join("b.odt");
        fs::write(&a, "x").unwrap();
        fs::write(&b, "x").unwrap();
        store.add_recent(&a, "a").unwrap();
        store.add_recent(&b, "b").unwrap();
        store.add_recent(&a, "a").unwrap();
        let titles: Vec<String> = store.recent().into_iter().map(|r| r.title).collect();
        assert_eq!(titles, ["a", "b"]);
        fs::remove_file(&b).unwrap();
        assert_eq!(store.recent().len(), 1, "arquivo apagado some da lista");
        store.remove_recent(&a.display().to_string()).unwrap();
        assert!(store.recent().is_empty());
    }

    #[test]
    fn recuperacao_guarda_e_descarta() {
        let (store, _) = store("recuperacao");
        assert!(store.recovery().is_none());
        let info = RecoveryInfo {
            title: "Carta".into(),
            path: None,
            saved_at: 1,
        };
        store.save_recovery(b"NOVA..", &info).unwrap();
        let (back, bytes) = store.recovery().unwrap();
        assert_eq!(back, info);
        assert_eq!(bytes, b"NOVA..");
        store.discard_recovery();
        assert!(store.recovery().is_none());
    }
}

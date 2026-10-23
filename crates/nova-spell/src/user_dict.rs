//! Dicionário do usuário: palavras adicionadas ("Adicionar ao dicionário") e
//! ignoradas ("Ignorar tudo"), guardadas num JSON legível:
//!
//! ```json
//! { "version": 1, "words": ["NovaOffice"], "ignored": ["Acnaell"] }
//! ```

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::SpellError;

const VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserDictionary {
    #[serde(default = "version")]
    version: u32,
    #[serde(default)]
    words: BTreeSet<String>,
    #[serde(default)]
    ignored: BTreeSet<String>,
    /// Arquivo de onde veio e para onde `save` escreve.
    #[serde(skip)]
    path: Option<PathBuf>,
}

fn version() -> u32 {
    VERSION
}

impl Default for UserDictionary {
    fn default() -> Self {
        Self::new()
    }
}

impl UserDictionary {
    /// Dicionário vazio, só em memória.
    pub fn new() -> Self {
        UserDictionary {
            version: VERSION,
            words: BTreeSet::new(),
            ignored: BTreeSet::new(),
            path: None,
        }
    }

    /// Lê o dicionário de `path`; se o arquivo ainda não existe, começa vazio.
    /// Daí em diante, `Speller::add_word` e `Speller::ignore_all` salvam nele.
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, SpellError> {
        let path = path.into();
        let mut dict = match fs::read_to_string(&path) {
            Ok(json) => Self::from_json(&json)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => Self::new(),
            Err(e) => return Err(e.into()),
        };
        dict.path = Some(path);
        Ok(dict)
    }

    pub fn from_json(json: &str) -> Result<Self, SpellError> {
        Ok(serde_json::from_str(json)?)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("conjuntos de strings sempre viram JSON")
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    /// Grava no arquivo de `open`; sem arquivo, não faz nada. Escreve num
    /// temporário e renomeia, para uma queda no meio não corromper o dicionário.
    pub fn save(&self) -> Result<(), SpellError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
            fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, self.to_json())?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Palavras adicionadas, em ordem alfabética.
    pub fn words(&self) -> impl Iterator<Item = &str> {
        self.words.iter().map(String::as_str)
    }

    /// Palavras ignoradas, em ordem alfabética.
    pub fn ignored(&self) -> impl Iterator<Item = &str> {
        self.ignored.iter().map(String::as_str)
    }

    pub fn contains(&self, word: &str) -> bool {
        self.words.contains(word)
    }

    pub fn is_ignored(&self, word: &str) -> bool {
        self.ignored.contains(word)
    }

    /// `true` se a palavra é nova.
    pub(crate) fn insert_word(&mut self, word: &str) -> bool {
        self.words.insert(word.to_owned())
    }

    /// `true` se a palavra é nova.
    pub(crate) fn insert_ignored(&mut self, word: &str) -> bool {
        self.ignored.insert(word.to_owned())
    }
}

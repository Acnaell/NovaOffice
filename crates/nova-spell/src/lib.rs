//! Corretor ortográfico da NovaOffice, no espírito do LibreOffice: os mesmos
//! dicionários Hunspell (VERO para pt-BR, SCOWL para en-US, RLA-ES para es),
//! lidos pelo `spellbook`, uma implementação de Hunspell em Rust puro.
//!
//! `Speller` verifica palavras soltas (`check`, `suggest`) e texto corrido
//! (`misspelled`), que devolve intervalos em unidades UTF-16, como os offsets
//! do `nova-domain-text`.

mod words;

pub use words::{words, Word};

use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;

use thiserror::Error;

/// Máximo de sugestões devolvidas por `Speller::suggest`.
pub const MAX_SUGGESTIONS: usize = 8;

/// Apóstrofos reconhecidos; o primeiro é o que os dicionários usam.
const APOSTROPHES: [char; 3] = ['\'', '\u{2019}', '\u{02bc}'];
/// Hífens reconhecidos; o primeiro é o que os dicionários usam.
const HYPHENS: [char; 3] = ['-', '\u{2010}', '\u{2011}'];

/// Idiomas com dicionário embutido.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    /// Português do Brasil (VERO).
    PtBr,
    /// Inglês dos EUA (SCOWL).
    EnUs,
    /// Espanhol (RLA-ES, variante es_ES).
    Es,
}

impl Language {
    pub const ALL: [Language; 3] = [Language::PtBr, Language::EnUs, Language::Es];

    /// Etiqueta BCP 47, a mesma usada pela interface.
    pub fn tag(self) -> &'static str {
        match self {
            Language::PtBr => "pt-BR",
            Language::EnUs => "en-US",
            Language::Es => "es",
        }
    }

    fn files(self) -> (&'static str, &'static str) {
        match self {
            Language::PtBr => (
                include_str!("../dicionarios/pt_BR.aff"),
                include_str!("../dicionarios/pt_BR.dic"),
            ),
            Language::EnUs => (
                include_str!("../dicionarios/en_US.aff"),
                include_str!("../dicionarios/en_US.dic"),
            ),
            Language::Es => (
                include_str!("../dicionarios/es_ES.aff"),
                include_str!("../dicionarios/es_ES.dic"),
            ),
        }
    }
}

impl fmt::Display for Language {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.tag())
    }
}

/// Aceita a etiqueta completa ou só o idioma ("pt-BR", "pt_br", "pt", "en", "es-MX"…).
impl FromStr for Language {
    type Err = SpellError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let lower = s.trim().to_ascii_lowercase();
        match lower.split(['-', '_']).next().unwrap_or_default() {
            "pt" => Ok(Language::PtBr),
            "en" => Ok(Language::EnUs),
            "es" => Ok(Language::Es),
            _ => Err(SpellError::UnknownLanguage(s.to_owned())),
        }
    }
}

#[derive(Debug, Error)]
pub enum SpellError {
    #[error("idioma sem dicionário: {0}")]
    UnknownLanguage(String),
    #[error("dicionário {language} inválido: {message}")]
    Dictionary { language: Language, message: String },
}

/// Corretor de um idioma.
///
/// Carregar é caro (o dicionário pt-BR tem mais de 300 mil radicais); a
/// aplicação deve carregar uma vez por idioma e compartilhar o `Speller`.
pub struct Speller {
    language: Language,
    dict: spellbook::Dictionary,
}

impl fmt::Debug for Speller {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Speller")
            .field("language", &self.language)
            .finish_non_exhaustive()
    }
}

impl Speller {
    /// Carrega o dicionário embutido do idioma.
    pub fn load(language: Language) -> Result<Self, SpellError> {
        let (aff, dic) = language.files();
        let dict = spellbook::Dictionary::new(strip_bom(aff), strip_bom(dic)).map_err(|e| {
            SpellError::Dictionary {
                language,
                message: e.to_string(),
            }
        })?;
        Ok(Speller { language, dict })
    }

    pub fn language(&self) -> Language {
        self.language
    }

    /// A palavra está no dicionário.
    pub fn check(&self, word: &str) -> bool {
        let word = word.trim();
        if word.is_empty() || self.dict.check(word) {
            return true;
        }
        // Os dicionários usam o apóstrofo e o hífen ASCII; o texto digitado
        // costuma trazer os tipográficos (’ e ‐).
        normalize(word).is_some_and(|w| self.dict.check(&w))
    }

    /// Até `MAX_SUGGESTIONS` sugestões, a melhor primeiro. As regras REP e MAP
    /// do dicionário (como "ss" → "ç" no VERO) vêm antes das parecidas por n-gramas.
    pub fn suggest(&self, word: &str) -> Vec<String> {
        let word = word.trim();
        if word.is_empty() {
            return Vec::new();
        }
        let normalized = normalize(word);
        let query = normalized.as_deref().unwrap_or(word);
        let mut raw = Vec::new();
        self.dict.suggest(query, &mut raw);
        let mut out: Vec<String> = Vec::with_capacity(MAX_SUGGESTIONS);
        for suggestion in raw {
            if suggestion != query && !out.contains(&suggestion) {
                out.push(suggestion);
                if out.len() == MAX_SUGGESTIONS {
                    break;
                }
            }
        }
        out
    }

    /// Intervalos `(início, fim)` em unidades UTF-16 das palavras erradas de
    /// `text`. Segue as regras do Word: ignora números, palavras com dígitos,
    /// URLs, e-mails e palavras TODAS EM MAIÚSCULAS (veja `words`).
    pub fn misspelled(&self, text: &str) -> Vec<(u32, u32)> {
        // Num texto, as mesmas palavras se repetem muito; consultar o
        // dicionário uma vez por palavra distinta deixa a verificação linear.
        let mut known: HashMap<&str, bool> = HashMap::new();
        words(text)
            .into_iter()
            .filter(|w| !*known.entry(w.text).or_insert_with(|| self.check(w.text)))
            .map(|w| (w.start, w.end))
            .collect()
    }
}

fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

/// Troca apóstrofos e hífens tipográficos pelos ASCII; `None` se não havia nenhum.
fn normalize(word: &str) -> Option<String> {
    let typographic = |c: char| APOSTROPHES[1..].contains(&c) || HYPHENS[1..].contains(&c);
    if !word.chars().any(typographic) {
        return None;
    }
    Some(
        word.chars()
            .map(|c| {
                if APOSTROPHES.contains(&c) {
                    APOSTROPHES[0]
                } else if HYPHENS.contains(&c) {
                    HYPHENS[0]
                } else {
                    c
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests;

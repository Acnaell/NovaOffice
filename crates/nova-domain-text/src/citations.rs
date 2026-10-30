//! Citações e bibliografia (Referências → Citações e Bibliografia; ADR 0013).
//!
//! Cada fonte (livro, artigo, site, tese) fica nas configurações do documento,
//! na chave `src:<id>`, como JSON. A chamada no texto é o caractere
//! `CITATION_CHAR` com a marca `citation {id, page?}`; o texto dela, como
//! "(SILVA, 2026, p. 12)", é gerado na hora pela regra autor-data da ABNT
//! (NBR 10520) e não fica gravado. A bibliografia são parágrafos comuns
//! marcados com `bibliography` (título e entradas), como o Sumário.

use nova_crdt::AttrValue;
use serde::{Deserialize, Serialize};

use crate::format::is_note_id;
use crate::DomainError;

/// Caractere da chamada de citação (uso privado do Unicode, ao lado do da nota).
pub const CITATION_CHAR: char = '\u{E001}';

/// Prefixo das chaves das fontes nas configurações do documento.
pub(crate) const SOURCE_PREFIX: &str = "src:";

/// Maior campo de uma fonte, em caracteres (o título pode ser longo).
pub const MAX_SOURCE_FIELD: usize = 2000;

/// Tipo de fonte, como em Gerenciar Fontes do Word.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    #[default]
    Book,
    Article,
    Web,
    Thesis,
}

/// Autor: sobrenome e prenomes. Entidade (empresa, órgão) só com `last`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Person {
    #[serde(default)]
    pub last: String,
    #[serde(default)]
    pub first: String,
}

/// Fonte bibliográfica. Campos vazios não são gravados.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    #[serde(default)]
    pub kind: SourceKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub authors: Vec<Person>,
    /// Título; o que vem depois de ": " é o subtítulo (sem negrito na ABNT).
    pub title: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub year: String,
    /// Editora (livro) ou nome do site.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub publisher: String,
    /// Local de publicação (cidade).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub place: String,
    /// Número da edição ("2" vira "2. ed.").
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub edition: String,
    /// Periódico (artigo).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub journal: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub volume: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub issue: String,
    /// Páginas do artigo ("15-30").
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pages: String,
    /// Instituição (tese).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub institution: String,
    /// Tipo do trabalho (tese): "Tese (Doutorado em Educação)".
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub degree: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub url: String,
    /// Data de acesso, `AAAA-MM-DD`.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub accessed: String,
}

impl Source {
    pub fn validate(&self, id: &str) -> Result<(), DomainError> {
        let bad = |msg: String| Err(DomainError::InvalidAttr(format!("fonte: {msg}")));
        if !is_note_id(id) {
            return bad(format!("id {id:?}: de 1 a 32 letras ou dígitos"));
        }
        if self.title.trim().is_empty() && self.authors.is_empty() {
            return bad("informe o título ou um autor".into());
        }
        if self.authors.len() > 100 {
            return bad("até 100 autores".into());
        }
        let line = |s: &str| s.chars().count() <= MAX_SOURCE_FIELD && !s.contains(['\n', '\r']);
        let names = self.authors.iter().flat_map(|p| [&p.last, &p.first]);
        if !names.chain(self.fields()).all(|s| line(s)) {
            return bad(format!(
                "campos de até {MAX_SOURCE_FIELD} caracteres numa linha"
            ));
        }
        if !self.accessed.is_empty() && !is_iso_date(&self.accessed) {
            return bad(format!(
                "data de acesso {:?}: use AAAA-MM-DD",
                self.accessed
            ));
        }
        Ok(())
    }

    fn fields(&self) -> [&String; 13] {
        [
            &self.title,
            &self.year,
            &self.publisher,
            &self.place,
            &self.edition,
            &self.journal,
            &self.volume,
            &self.issue,
            &self.pages,
            &self.institution,
            &self.degree,
            &self.url,
            &self.accessed,
        ]
    }

    pub(crate) fn to_setting(&self) -> AttrValue {
        AttrValue::Text(serde_json::to_string(self).expect("fonte vira JSON"))
    }

    pub(crate) fn from_setting(id: &str, value: &AttrValue) -> Option<Source> {
        let AttrValue::Text(json) = value else {
            return None;
        };
        let s: Source = serde_json::from_str(json).ok()?;
        s.validate(id).is_ok().then_some(s)
    }

    /// Autor da chamada: "SILVA", "SILVA; SOUZA", "SILVA et al." (4 ou mais
    /// autores) ou, sem autor, a primeira palavra do título: "METODOLOGIA...".
    pub fn citation_author(&self) -> String {
        let names: Vec<String> = self
            .authors
            .iter()
            .map(|p| p.last.trim())
            .filter(|l| !l.is_empty())
            .map(str::to_uppercase)
            .collect();
        match names.len() {
            0 => {
                let word = self.title.split_whitespace().next().unwrap_or("");
                let word = word.trim_end_matches([':', ',', '.', ';']);
                format!("{}...", word.to_uppercase())
            }
            1..=3 => names.join("; "),
            _ => format!("{} et al.", names[0]),
        }
    }
}

/// Texto da chamada autor-data: "(SILVA, 2026)" ou "(SILVA, 2026, p. 12)".
/// Fonte apagada: "(?)".
pub fn citation_text(source: Option<&Source>, page: Option<&str>) -> String {
    let Some(source) = source else {
        return "(?)".into();
    };
    let year = match source.year.trim() {
        "" => "[s. d.]",
        y => y,
    };
    let mut out = format!("({}, {year}", source.citation_author());
    if let Some(p) = page.map(str::trim).filter(|p| !p.is_empty()) {
        out.push_str(&format!(", p. {p}"));
    }
    out.push(')');
    out
}

/// Página de uma citação: até 32 caracteres numa linha.
pub(crate) fn is_citation_page(page: &str) -> bool {
    !page.trim().is_empty() && page.chars().count() <= 32 && !page.chars().any(char::is_control)
}

fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

pub(crate) fn source_key(id: &str) -> String {
    format!("{SOURCE_PREFIX}{id}")
}

/// Parte da bibliografia que um parágrafo é: o título ("REFERÊNCIAS") ou uma entrada.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BibPart {
    Title,
    Entry,
}

impl BibPart {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            BibPart::Title => "title",
            BibPart::Entry => "entry",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<BibPart> {
        match value {
            "title" => Some(BibPart::Title),
            "entry" => Some(BibPart::Entry),
            _ => None,
        }
    }
}

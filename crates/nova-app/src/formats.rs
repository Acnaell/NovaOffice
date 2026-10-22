//! Formatos de arquivo do Nova Text: escolha pela extensão, abrir e gravar.

use std::path::Path;

use nova_crdt::ClientId;
use nova_domain_text::TextDocument;
use serde_json::{json, Value};

use crate::{docx, file, html, markdown, odt, AppError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// Documento do Word, o padrão ao salvar (como no Word).
    Docx,
    /// Documento de texto ODF (LibreOffice).
    Odt,
    /// Formato nativo do Nova, com histórico CRDT para coedição.
    Nova,
    Markdown,
    Text,
    Html,
}

impl Format {
    /// Ordem da lista "Tipo" em Salvar como.
    pub const ALL: [Format; 6] = [
        Format::Docx,
        Format::Odt,
        Format::Nova,
        Format::Markdown,
        Format::Text,
        Format::Html,
    ];

    pub fn extension(self) -> &'static str {
        match self {
            Format::Docx => "docx",
            Format::Odt => "odt",
            Format::Nova => "nova",
            Format::Markdown => "md",
            Format::Text => "txt",
            Format::Html => "html",
        }
    }

    pub fn from_path(path: &Path) -> Option<Format> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        Some(match ext.as_str() {
            "docx" | "docm" => Format::Docx,
            "odt" => Format::Odt,
            "nova" => Format::Nova,
            "md" | "markdown" => Format::Markdown,
            "txt" | "text" | "csv" | "log" => Format::Text,
            "html" | "htm" => Format::Html,
            _ => return None,
        })
    }

    /// Formatos que guardam tudo o que o Nova Text representa hoje. Os demais
    /// perdem fonte, cor, alinhamento etc. (o Word avisa nesse caso também).
    pub fn keeps_formatting(self) -> bool {
        matches!(
            self,
            Format::Docx | Format::Odt | Format::Nova | Format::Html
        )
    }

    /// Lista para a interface: extensão, se abre, se mantém a formatação.
    pub fn catalog() -> Value {
        Value::Array(
            Format::ALL
                .iter()
                .map(|f| {
                    json!({
                        "extension": f.extension(),
                        "canOpen": *f != Format::Html,
                        "keepsFormatting": f.keeps_formatting(),
                    })
                })
                .collect(),
        )
    }
}

/// Abre um arquivo; extensões desconhecidas abrem como texto simples.
pub fn open(client: ClientId, path: &Path, bytes: &[u8]) -> Result<TextDocument, AppError> {
    match Format::from_path(path) {
        Some(Format::Nova) => file::decode(client, bytes),
        Some(Format::Docx) => docx::import(client, bytes),
        Some(Format::Odt) => odt::import(client, bytes),
        Some(Format::Markdown) => markdown::import(client, &text(bytes)),
        _ => Ok(TextDocument::from_plain_text(client, &text(bytes))),
    }
}

/// Texto em UTF-8; se não for (arquivos antigos do Windows), lê como Latin-1.
fn text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

pub fn save(doc: &TextDocument, format: Format, title: &str) -> Vec<u8> {
    match format {
        Format::Nova => file::encode(doc),
        Format::Docx => docx::export(doc),
        Format::Odt => odt::export(doc),
        Format::Markdown => markdown::export(doc).into_bytes(),
        Format::Text => doc.to_plain_text().replace('\u{b}', "\n").into_bytes(),
        Format::Html => html::export(doc, title).into_bytes(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn extensoes() {
        assert_eq!(
            Format::from_path(&PathBuf::from("a.DOCX")),
            Some(Format::Docx)
        );
        assert_eq!(
            Format::from_path(&PathBuf::from("a.markdown")),
            Some(Format::Markdown)
        );
        assert_eq!(Format::from_path(&PathBuf::from("a")), None);
        assert_eq!(Format::ALL[0], Format::Docx, "Word é o padrão");
    }

    #[test]
    fn todos_os_formatos_abrem_o_que_gravam() {
        let doc = TextDocument::from_plain_text(1, "Olá\nmundo");
        for f in Format::ALL {
            if f == Format::Html {
                continue;
            }
            let path = PathBuf::from(format!("x.{}", f.extension()));
            let back = open(2, &path, &save(&doc, f, "x")).unwrap();
            assert_eq!(back.to_plain_text(), "Olá\nmundo", "{f:?}");
        }
    }

    #[test]
    fn texto_em_latin1_e_com_bom() {
        let doc = open(1, &PathBuf::from("a.txt"), b"\xEF\xBB\xBFol\xC3\xA1").unwrap();
        assert_eq!(doc.to_plain_text(), "olá");
        let doc = open(1, &PathBuf::from("a.txt"), b"ol\xE1").unwrap();
        assert_eq!(doc.to_plain_text(), "olá");
    }
}

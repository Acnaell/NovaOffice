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

    /// Tabela 2×2 com uma célula de dois parágrafos e uma sombreada, entre parágrafos comuns.
    fn com_tabela() -> TextDocument {
        use nova_domain_text::{CellRef, ParaAttrs, Paragraph, Span};
        let p = |text: &str, cell: Option<(u16, u16)>, shading: Option<&str>| Paragraph {
            attrs: ParaAttrs {
                cell: cell.map(|(row, col)| CellRef {
                    table: "t1".into(),
                    row,
                    col,
                }),
                shading: shading.map(str::to_string),
                ..ParaAttrs::default()
            },
            spans: vec![Span {
                text: text.into(),
                marks: vec![],
            }],
            ..Paragraph::default()
        };
        TextDocument::from_paragraphs(
            1,
            &[
                p("antes", None, None),
                p("Nome", Some((0, 0)), Some("#D9E2F3")),
                p("Idade", Some((0, 1)), Some("#D9E2F3")),
                p("Ana", Some((1, 0)), None),
                p("30", Some((1, 1)), None),
                p("anos", Some((1, 1)), None),
                p("depois", None, None),
            ],
        )
        .unwrap()
    }

    #[test]
    fn tabelas_vao_e_voltam() {
        let doc = com_tabela();
        for format in [Format::Docx, Format::Odt, Format::Nova] {
            let bytes = save(&doc, format, "t");
            let back = open(2, Path::new(&format!("x.{}", format.extension())), &bytes).unwrap();
            assert_eq!(back.paragraphs(), doc.paragraphs(), "{format:?}");
        }
        let md = String::from_utf8(save(&doc, Format::Markdown, "t")).unwrap();
        assert!(
            md.contains("| Nome | Idade |\n| --- | --- |\n| Ana | 30<br>anos |"),
            "{md}"
        );
        let back = open(2, Path::new("x.md"), md.as_bytes()).unwrap();
        let texts: Vec<String> = back.paragraphs().iter().map(|p| p.text()).collect();
        assert_eq!(
            texts,
            ["antes", "Nome", "Idade", "Ana", "30", "anos", "depois"]
        );
        assert_eq!(
            back.paragraphs()[5]
                .attrs
                .cell
                .as_ref()
                .map(|c| (c.row, c.col)),
            Some((1, 1))
        );
        let html = String::from_utf8(save(&doc, Format::Html, "t")).unwrap();
        assert_eq!(html.matches("<td").count(), 4);
    }

    /// PNG 2×1 (vermelho e azul).
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x7B,
        0x40, 0xE8, 0xDD, 0x00, 0x00, 0x00, 0x0F, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8,
        0xCF, 0xC0, 0xC0, 0xF0, 0x1F, 0x08, 0x00, 0x0B, 0xF8, 0x02, 0xFE, 0x8E, 0x22, 0x9B, 0x3E,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn imagens_vao_e_voltam() {
        use nova_domain_text::{Align, ParaAttr, TextCommand};
        let mut doc = TextDocument::from_plain_text(1, "antes\n\ndepois");
        let image = crate::media::embed(&doc, PNG, Some((240, 120))).unwrap();
        doc.execute(TextCommand::Batch {
            commands: vec![
                TextCommand::SetBlockAttr {
                    block: 1,
                    attr: ParaAttr::Image(Some(image.clone())),
                },
                TextCommand::SetBlockAttr {
                    block: 1,
                    attr: ParaAttr::Align(Align::Center),
                },
            ],
        })
        .unwrap();
        for format in [Format::Docx, Format::Odt, Format::Nova, Format::Markdown] {
            let bytes = save(&doc, format, "t");
            let back = open(2, Path::new(&format!("x.{}", format.extension())), &bytes).unwrap();
            let p = back.paragraphs();
            let texts: Vec<String> = p.iter().map(|p| p.text()).collect();
            assert_eq!(texts, ["antes", "", "depois"], "{format:?}");
            let got = p[1]
                .attrs
                .image
                .as_ref()
                .unwrap_or_else(|| panic!("{format:?}: sem imagem"));
            assert_eq!(back.media(&got.id).unwrap().1, PNG, "{format:?}");
            if format != Format::Markdown {
                assert_eq!(got, &image, "{format:?}");
                assert_eq!(p[1].attrs.align, Align::Center, "{format:?}");
            }
        }
        let html = String::from_utf8(save(&doc, Format::Html, "t")).unwrap();
        assert!(html.contains(r#"<img src="data:image/png;base64,"#));
    }
}

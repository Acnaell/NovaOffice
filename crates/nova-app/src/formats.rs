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

    #[test]
    fn pagina_vai_e_volta() {
        use nova_domain_text::{PageSetup, TextCommand};
        let mut doc = TextDocument::from_plain_text(1, "paisagem");
        // Ofício em paisagem, margens ABNT (3 cm em cima e à esquerda, 2 cm embaixo e à direita).
        let page = PageSetup {
            width: 20160,
            height: 12240,
            margin_top: 1701,
            margin_bottom: 1134,
            margin_left: 1701,
            margin_right: 1134,
            ..PageSetup::default()
        };
        doc.execute(TextCommand::SetPage { page: page.clone() })
            .unwrap();
        for format in [Format::Docx, Format::Odt, Format::Nova] {
            let bytes = save(&doc, format, "t");
            let back = open(2, Path::new(&format!("x.{}", format.extension())), &bytes).unwrap();
            let got = back.page_setup();
            // O .odt guarda em centímetros com 3 casas: diferença de até 1 twip.
            let close = |a: u32, b: u32| a.abs_diff(b) <= 1;
            assert!(
                close(got.width, page.width)
                    && close(got.height, page.height)
                    && close(got.margin_top, page.margin_top)
                    && close(got.margin_left, page.margin_left)
                    && close(got.margin_bottom, page.margin_bottom),
                "{format:?}: {got:?}"
            );
            assert!(!back.can_undo(), "{format:?}: abrir não entra no desfazer");
        }
    }

    #[test]
    fn cabecalho_e_rodape_vao_e_voltam() {
        use nova_domain_text::{Align, HeaderFooter, HeadersFooters, TextCommand};
        let mut doc = TextDocument::from_plain_text(1, "corpo");
        let value = HeadersFooters {
            header: HeaderFooter {
                text: "Universidade  Federal\u{b}Relatório".into(),
                align: Align::Center,
            },
            footer: HeaderFooter {
                text: "Página {PAGE} de {NUMPAGES}".into(),
                align: Align::Right,
            },
            different_first: true,
        };
        doc.execute(TextCommand::SetHeaderFooter {
            value: value.clone(),
        })
        .unwrap();
        for format in [Format::Docx, Format::Odt, Format::Nova] {
            let bytes = save(&doc, format, "t");
            let back = open(2, Path::new(&format!("x.{}", format.extension())), &bytes).unwrap();
            assert_eq!(back.header_footer(), value, "{format:?}");
            assert!(!back.can_undo(), "{format:?}");
        }
    }

    /// Aba Design: cor da página, borda (caixa, sombra e dupla) e marca d'água
    /// (diagonal e horizontal, com e sem Primeira Página Diferente).
    #[test]
    fn design_da_pagina_vai_e_volta() {
        use nova_domain_text::{
            BorderStyle, HeaderFooter, HeadersFooters, PageBorder, PageSetup, TextCommand,
            Watermark, WatermarkLayout,
        };
        let cases = [
            (
                Some("#FFF2CC"),
                BorderStyle::Single,
                4,
                "CONFIDENCIAL",
                WatermarkLayout::Diagonal,
                true,
                false,
            ),
            (
                Some("#DDEBF7"),
                BorderStyle::Shadow,
                12,
                "NÃO COPIE",
                WatermarkLayout::Horizontal,
                false,
                true,
            ),
            (
                None,
                BorderStyle::Double,
                6,
                "Rascunho & <revisão>",
                WatermarkLayout::Diagonal,
                true,
                true,
            ),
        ];
        for (background, style, width, text, layout, semitransparent, different_first) in cases {
            let mut doc = TextDocument::from_plain_text(
                1,
                "corpo
segunda linha",
            );
            let page = PageSetup {
                background: background.map(str::to_string),
                border: Some(PageBorder {
                    style,
                    color: "#2F5496".into(),
                    width,
                }),
                ..PageSetup::default()
            };
            let watermark = Watermark {
                text: text.into(),
                color: "#FF0000".into(),
                semitransparent,
                layout,
            };
            let hf = HeadersFooters {
                header: HeaderFooter {
                    text: if different_first {
                        String::new()
                    } else {
                        "Relatório {PAGE}".into()
                    },
                    ..HeaderFooter::default()
                },
                different_first,
                ..HeadersFooters::default()
            };
            doc.execute(TextCommand::Batch {
                commands: vec![
                    TextCommand::SetPage { page: page.clone() },
                    TextCommand::SetWatermark {
                        value: Some(watermark.clone()),
                    },
                    TextCommand::SetHeaderFooter { value: hf.clone() },
                ],
            })
            .unwrap();
            for format in [Format::Docx, Format::Odt, Format::Nova] {
                let bytes = save(&doc, format, "t");
                let back =
                    open(2, Path::new(&format!("x.{}", format.extension())), &bytes).unwrap();
                let got = back.page_setup();
                assert_eq!(got.background, page.background, "{format:?}");
                assert_eq!(got.border, page.border, "{format:?}");
                // O .odt guarda a margem em partes (margem, borda, enchimento), em cm com 3 casas.
                let close = |a: u32, b: u32| a.abs_diff(b) <= 2;
                assert!(
                    close(got.margin_top, page.margin_top)
                        && close(got.margin_left, page.margin_left)
                        && close(got.margin_right, page.margin_right)
                        && close(got.margin_bottom, page.margin_bottom),
                    "{format:?}: {got:?}"
                );
                assert_eq!(back.watermark(), Some(watermark.clone()), "{format:?}");
                // A marca d'água não vira texto do cabeçalho.
                assert_eq!(back.header_footer(), hf, "{format:?}");
                assert_eq!(
                    back.to_plain_text(),
                    "corpo
segunda linha",
                    "{format:?}"
                );
                assert!(!back.can_undo(), "{format:?}");
            }
        }
    }

    #[test]
    fn design_no_xml_como_o_word_e_o_libreoffice_gravam() {
        use nova_domain_text::{BorderStyle, PageBorder, PageSetup, TextCommand, Watermark};
        let mut doc = TextDocument::from_plain_text(1, "x");
        doc.execute(TextCommand::SetPage {
            page: PageSetup {
                background: Some("#FFF2CC".into()),
                border: Some(PageBorder {
                    style: BorderStyle::Shadow,
                    color: "#000000".into(),
                    width: 4,
                }),
                ..PageSetup::default()
            },
        })
        .unwrap();
        doc.execute(TextCommand::SetWatermark {
            value: Some(Watermark::default()),
        })
        .unwrap();
        let part = |bytes: &[u8], name: &str| {
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
            let mut out = String::new();
            std::io::Read::read_to_string(&mut zip.by_name(name).unwrap(), &mut out).unwrap();
            out
        };
        let docx = save(&doc, Format::Docx, "t");
        let document = part(&docx, "word/document.xml");
        assert!(document.contains(r#"<w:background w:color="FFF2CC"/><w:body>"#));
        assert!(document.contains(r#"<w:pgBorders w:offsetFrom="page"><w:top w:val="single" w:sz="4" w:space="24" w:color="000000" w:shadow="1"/>"#));
        assert!(part(&docx, "word/settings.xml").contains("<w:displayBackgroundShape/>"));
        let header = part(&docx, "word/header1.xml");
        assert!(
            header.contains(r#"<v:shape id="PowerPlusWaterMarkObject1""#),
            "{header}"
        );
        assert!(header.contains(r#"string="CONFIDENCIAL""#) && header.contains("rotation:315"));
        let odt = save(&doc, Format::Odt, "t");
        let styles = part(&odt, "styles.xml");
        assert!(
            styles.contains(r##"fo:background-color="#fff2cc""##),
            "{styles}"
        );
        assert!(styles.contains(r##"fo:border="0.50pt solid #000000""##));
        assert!(styles.contains("style:shadow="));
        assert!(styles.contains(r#"draw:type="fontwork-plain-text""#));
        assert!(styles.contains(r#"draw:opacity="50%""#));
    }

    #[test]
    fn sumario_vai_e_volta() {
        use nova_domain_text::{BlockStyle, Paragraph, Span, TocEntry};
        let para = |text: &str, style: BlockStyle, toc: Option<TocEntry>| {
            let mut p = Paragraph {
                style,
                spans: vec![Span {
                    text: text.into(),
                    marks: vec![],
                }],
                ..Paragraph::default()
            };
            p.attrs.toc = toc;
            p
        };
        let entry = |level, page| Some(TocEntry { level, page });
        let paragraphs = vec![
            para("Sumário", BlockStyle::Paragraph, entry(0, 0)),
            para("Introdução", BlockStyle::Paragraph, entry(1, 2)),
            para("Objetivos", BlockStyle::Paragraph, entry(2, 3)),
            para("Conclusão", BlockStyle::Paragraph, entry(1, 7)),
            para("Introdução", BlockStyle::Heading1, None),
        ];
        let doc = TextDocument::from_paragraphs(1, &paragraphs).unwrap();
        for format in [Format::Docx, Format::Odt, Format::Nova] {
            let bytes = save(&doc, format, "t");
            let back = open(2, Path::new(&format!("x.{}", format.extension())), &bytes).unwrap();
            let got: Vec<(String, Option<TocEntry>)> = back
                .paragraphs()
                .iter()
                .map(|p| (p.text(), p.attrs.toc))
                .collect();
            let want: Vec<(String, Option<TocEntry>)> =
                paragraphs.iter().map(|p| (p.text(), p.attrs.toc)).collect();
            assert_eq!(got, want, "{format:?}");
        }
        let xml = String::from_utf8_lossy(&save(&doc, Format::Docx, "t")).to_string();
        assert!(!xml.is_empty());
    }
}

//! Documento do Word (.docx, Office Open XML): gravar e abrir.
//!
//! Grava estilos (Normal, Título 1–6, Citação, Código), listas com
//! marcadores e numeradas por nível, alinhamento, recuo, espaçamento e as
//! marcas de caractere, além do sombreamento. Ao abrir, aplica a formatação na
//! ordem do Word: padrões do documento, estilo do parágrafo (e os que ele herda),
//! estilo de caractere e formatação direta. O que o Nova ainda não representa
//! (tabelas, imagens, campos, notas, bordas) vira texto simples ou é ignorado.

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};

use nova_crdt::ClientId;
use nova_domain_text::{
    Align, BlockStyle, ListKind, Mark, Paragraph, Span, TextDocument, HIGHLIGHT_COLORS, MAX_INDENT,
    MAX_TABLE_SIZE,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

use crate::AppError;

/// Recuo por nível em twips (1,27 cm), o padrão do Word.
const INDENT_TWIPS: u32 = 720;

// ---------------------------------------------------------------- gravar

pub fn export(doc: &TextDocument) -> Vec<u8> {
    let paragraphs = doc.paragraphs();
    // Imagens usadas, na ordem em que aparecem: (id, tipo, bytes).
    let mut images: Vec<(String, String, Vec<u8>)> = Vec::new();
    for p in &paragraphs {
        if let Some(image) = &p.attrs.image {
            if !images.iter().any(|(id, ..)| *id == image.id) {
                if let Some((mime, data)) = doc.media(&image.id) {
                    images.push((image.id.clone(), mime, data));
                }
            }
        }
    }
    let notes = doc.footnotes();
    let (body, nums, links) = body_xml(&paragraphs, &images, doc.page_setup(), &notes);
    let media_names: Vec<String> = images
        .iter()
        .enumerate()
        .map(|(i, (_, mime, _))| format!("media/image{}.{}", i + 1, crate::media::extension(mime)))
        .collect();
    // Cabeçalho e rodapé: partes próprias, referenciadas no w:sectPr.
    let hf = doc.header_footer();
    let mut body = body;
    let mut extra_rels = String::new();
    let mut extra_types = String::new();
    let mut extra_files: Vec<(&str, String)> = Vec::new();
    let mut refs = String::new();
    for (kind, part, value) in [
        ("header", "header1.xml", &hf.header),
        ("footer", "footer1.xml", &hf.footer),
    ] {
        if value.text.is_empty() {
            continue;
        }
        let tag = if kind == "header" { "hdr" } else { "ftr" };
        let id = if kind == "header" { "rIdHdr" } else { "rIdFtr" };
        extra_files.push((
            if kind == "header" {
                "word/header1.xml"
            } else {
                "word/footer1.xml"
            },
            header_footer_xml(tag, value),
        ));
        extra_rels.push_str(&format!(
            r#"<Relationship Id="{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" Target="{part}"/>"#
        ));
        extra_types.push_str(&format!(
            r#"<Override PartName="/word/{part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>"#
        ));
        refs.push_str(&format!(
            r#"<w:{kind}Reference w:type="default" r:id="{id}"/>"#
        ));
    }
    // Notas de rodapé: word/footnotes.xml (com os separadores) e as configurações que o Word espera.
    if !notes.is_empty() {
        extra_files.push(("word/footnotes.xml", footnotes_xml(&notes)));
        extra_files.push(("word/settings.xml", SETTINGS_XML.to_string()));
        extra_rels.push_str(r#"<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rIdSet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>"#);
        extra_types.push_str(r#"<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>"#);
    }
    body = body.replacen("<w:sectPr>", &format!("<w:sectPr>{refs}"), 1);
    if hf.different_first {
        body = body.replacen("</w:sectPr>", "<w:titlePg/></w:sectPr>", 1);
    }
    let mut files: Vec<(&str, String)> = vec![
        ("[Content_Types].xml", CONTENT_TYPES.to_string()),
        ("_rels/.rels", ROOT_RELS.to_string()),
        ("docProps/app.xml", APP_XML.to_string()),
        ("docProps/core.xml", CORE_XML.to_string()),
        (
            "word/_rels/document.xml.rels",
            document_rels(&links, &media_names),
        ),
        ("word/document.xml", body),
        ("word/styles.xml", STYLES_XML.to_string()),
        ("word/numbering.xml", numbering_xml(&nums)),
    ];
    files.extend(extra_files);
    for (name, content) in files.iter_mut() {
        if *name == "word/_rels/document.xml.rels" {
            *content = content.replacen(
                "</Relationships>",
                &format!("{extra_rels}</Relationships>"),
                1,
            );
        }
        if *name == "[Content_Types].xml" {
            *content = content.replacen("</Types>", &format!("{extra_types}</Types>"), 1);
        }
    }
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in files {
        zip.start_file(name, options).expect("zip em memória");
        zip.write_all(content.as_bytes()).expect("zip em memória");
    }
    // Imagens já são comprimidas: vão sem compressão.
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, (_, _, data)) in media_names.iter().zip(&images) {
        zip.start_file(format!("word/{name}"), stored)
            .expect("zip em memória");
        zip.write_all(data).expect("zip em memória");
    }
    zip.finish().expect("zip em memória").into_inner()
}

/// `word/footnotes.xml`: os separadores (ids -1 e 0) e uma nota por id (1, 2…).
fn footnotes_xml(notes: &[(String, String)]) -> String {
    let mut out = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>"#,
    );
    for (n, (_, text)) in notes.iter().enumerate() {
        out.push_str(&format!(
            r#"<w:footnote w:id="{}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>"#,
            n + 1
        ));
        for (i, line) in text.split('\u{b}').enumerate() {
            if i > 0 {
                out.push_str("<w:r><w:br/></w:r>");
            }
            if !line.is_empty() {
                out.push_str(&format!(
                    r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
                    esc(line)
                ));
            }
        }
        out.push_str("</w:p></w:footnote>");
    }
    out.push_str("</w:footnotes>");
    out
}

/// Configurações mínimas: os separadores das notas de rodapé.
const SETTINGS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr></w:settings>"#;

/// Notas de rodapé de `word/footnotes.xml`: número → texto (sem os separadores).
fn read_footnotes(xml: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut current: Option<(String, String, u32)> = None; // id, texto, parágrafos
    let mut in_t = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"footnote" => {
                    current = match (attr(&e, b"id"), attr(&e, b"type")) {
                        (Some(id), None) => Some((id, String::new(), 0)),
                        _ => None,
                    };
                }
                b"p" => {
                    if let Some(c) = current.as_mut() {
                        if c.2 > 0 && !c.1.is_empty() {
                            c.1.push('\u{b}');
                        }
                        c.2 += 1;
                    }
                }
                b"t" => in_t = true,
                b"tab" => {
                    if let Some(c) = current.as_mut() {
                        c.1.push('\t');
                    }
                }
                b"br" => {
                    if let Some(c) = current.as_mut() {
                        c.1.push('\u{b}');
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) if in_t => {
                if let Some(c) = current.as_mut() {
                    c.1.push_str(&t.unescape().map(|v| v.into_owned()).unwrap_or_default());
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = false,
                b"footnote" => {
                    if let Some((id, text, _)) = current.take() {
                        let text: String = text
                            .trim()
                            .chars()
                            .take(nova_domain_text::MAX_NOTE_CHARS)
                            .collect();
                        out.insert(id, text);
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

/// `w:hdr`/`w:ftr` com um parágrafo: texto, quebras de linha e os campos PAGE e NUMPAGES.
fn header_footer_xml(tag: &str, value: &nova_domain_text::HeaderFooter) -> String {
    let mut out = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:{tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p>"#
    );
    let jc = match value.align {
        Align::Center => "center",
        Align::Right => "right",
        Align::Justify => "both",
        Align::Left => "",
    };
    if !jc.is_empty() {
        out.push_str(&format!(r#"<w:pPr><w:jc w:val="{jc}"/></w:pPr>"#));
    }
    let mut rest = value.text.as_str();
    while !rest.is_empty() {
        let next = [
            nova_domain_text::PAGE_FIELD,
            nova_domain_text::NUMPAGES_FIELD,
        ]
        .iter()
        .filter_map(|f| rest.find(f).map(|i| (i, *f)))
        .min();
        let (text, field) = match next {
            Some((i, f)) => (&rest[..i], Some(f)),
            None => (rest, None),
        };
        for (n, line) in text.split('\u{b}').enumerate() {
            if n > 0 {
                out.push_str("<w:r><w:br/></w:r>");
            }
            if !line.is_empty() {
                out.push_str(&format!(
                    r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
                    esc(line)
                ));
            }
        }
        match field {
            Some(f) => {
                let instr = if f == nova_domain_text::PAGE_FIELD {
                    "PAGE"
                } else {
                    "NUMPAGES"
                };
                out.push_str(&format!(
                    r#"<w:fldSimple w:instr=" {instr} \* MERGEFORMAT "><w:r><w:t>1</w:t></w:r></w:fldSimple>"#
                ));
                rest = &rest[text.len() + f.len()..];
            }
            None => rest = "",
        }
    }
    out.push_str(&format!("</w:p></w:{tag}>"));
    out
}

/// Texto de um `w:hdr`/`w:ftr`: parágrafos unidos por quebra de linha, campos
/// PAGE e NUMPAGES (simples ou complexos) viram `{PAGE}` e `{NUMPAGES}`.
fn read_header_footer(xml: &str) -> nova_domain_text::HeaderFooter {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut text = String::new();
    let mut align: Option<Align> = None;
    let (mut in_t, mut in_instr, mut paragraphs) = (false, false, 0);
    // Campo complexo: 0 = fora, 1 = lendo a instrução, 2 = resultado (ignorado).
    let mut field = 0;
    let mut instr = String::new();
    let mut simple_depth = 0u32;
    let field_token = |instr: &str| {
        let upper = instr.trim().to_uppercase();
        if upper.starts_with("NUMPAGES") {
            Some(nova_domain_text::NUMPAGES_FIELD)
        } else if upper.starts_with("PAGE") {
            Some(nova_domain_text::PAGE_FIELD)
        } else {
            None
        }
    };
    loop {
        match reader.read_event_into(&mut buf) {
            // <w:fldSimple …/> sem resultado: só o campo.
            Ok(Event::Empty(e)) if e.local_name().as_ref() == b"fldSimple" => {
                if let Some(token) = attr(&e, b"instr").as_deref().and_then(field_token) {
                    text.push_str(token);
                }
            }
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"p" => {
                    if paragraphs > 0 && !text.is_empty() {
                        text.push('\u{b}');
                    }
                    paragraphs += 1;
                }
                b"jc" if align.is_none() => {
                    align = Some(match attr(&e, b"val").as_deref() {
                        Some("center") => Align::Center,
                        Some("right" | "end") => Align::Right,
                        Some("both") => Align::Justify,
                        _ => Align::Left,
                    })
                }
                b"fldSimple" => {
                    if let Some(token) = attr(&e, b"instr").as_deref().and_then(field_token) {
                        text.push_str(token);
                    }
                    simple_depth += 1;
                }
                b"fldChar" => match attr(&e, b"fldCharType").as_deref() {
                    Some("begin") => {
                        field = 1;
                        instr.clear();
                    }
                    Some("separate") => {
                        if let Some(token) = field_token(&instr) {
                            text.push_str(token);
                        }
                        field = 2;
                    }
                    Some("end") => field = 0,
                    _ => {}
                },
                b"instrText" => in_instr = true,
                b"t" => in_t = true,
                b"tab" => text.push('\t'),
                b"br" => text.push('\u{b}'),
                _ => {}
            },
            Ok(Event::Text(t)) => {
                let value = t.unescape().map(|v| v.into_owned()).unwrap_or_default();
                if in_instr {
                    instr.push_str(&value);
                } else if in_t && field == 0 && simple_depth == 0 {
                    text.push_str(&value);
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = false,
                b"instrText" => in_instr = false,
                b"fldSimple" => simple_depth = simple_depth.saturating_sub(1),
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    let text: String = text.chars().take(1000).collect();
    nova_domain_text::HeaderFooter {
        text: text.trim_end_matches('\u{b}').to_string(),
        align: align.unwrap_or_default(),
    }
}

/// Pontos → EMU (unidade do DrawingML).
const EMU_PER_PT: u64 = 12700;

/// Uma imagem "alinhada com o texto" (`wp:inline`).
fn drawing_xml(out: &mut String, image: &nova_domain_text::ImageRef, index: usize) {
    let (cx, cy) = (
        u64::from(image.width) * EMU_PER_PT,
        u64::from(image.height) * EMU_PER_PT,
    );
    let n = index + 1;
    out.push_str(&format!(
        r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="{n}" name="Imagem {n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="{n}" name="Imagem {n}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg{n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#
    ));
}

fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // Caracteres de controle não são válidos em XML 1.0.
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

fn style_id(style: BlockStyle) -> Option<&'static str> {
    match style {
        BlockStyle::Paragraph => None,
        BlockStyle::Heading1 => Some("Heading1"),
        BlockStyle::Heading2 => Some("Heading2"),
        BlockStyle::Heading3 => Some("Heading3"),
        BlockStyle::Heading4 => Some("Heading4"),
        BlockStyle::Heading5 => Some("Heading5"),
        BlockStyle::Heading6 => Some("Heading6"),
        BlockStyle::Quote => Some("Quote"),
        BlockStyle::Code => Some("Code"),
    }
}

/// Uma instância de numeração do Word (`w:num`): cada lista numerada
/// recomeça do 1, como no Nova; marcadores compartilham uma só.
#[derive(Clone, Copy)]
enum Num {
    Bullet,
    Number,
}

/// Relações do documento: estilos, numeração e um alvo externo por link (rId10, rId11…).
fn document_rels(links: &[String], media: &[String]) -> String {
    let mut out = String::from(DOCUMENT_RELS.trim_end_matches("</Relationships>"));
    for (i, target) in media.iter().enumerate() {
        out.push_str(&format!(
            r#"<Relationship Id="rIdImg{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{target}"/>"#,
            i + 1
        ));
    }
    for (i, href) in links.iter().enumerate() {
        out.push_str(&format!(
            r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
            i + 10,
            esc(href)
        ));
    }
    out.push_str("</Relationships>");
    out
}

fn link_of(span: &Span) -> Option<&str> {
    span.marks.iter().find_map(|m| match m {
        Mark::Link { href } => Some(href.as_str()),
        _ => None,
    })
}

/// Largura útil da página A4 com margens de 2,5 cm, em twips.
const TEXT_WIDTH_TWIPS: u32 = 9638;

/// Abre e fecha `w:tbl`, `w:tr` e `w:tc` conforme os parágrafos passam,
/// completando células e linhas que faltem para a grade ficar retangular.
struct TableWriter {
    /// Colunas de cada tabela (pela maior coluna usada).
    cols: HashMap<String, u16>,
    open: Option<(String, u16, u16)>,
}

impl TableWriter {
    fn new(paragraphs: &[Paragraph]) -> Self {
        let mut cols: HashMap<String, u16> = HashMap::new();
        for c in paragraphs.iter().filter_map(|p| p.attrs.cell.as_ref()) {
            let n = cols.entry(c.table.clone()).or_default();
            *n = (*n).max(c.col + 1);
        }
        TableWriter { cols, open: None }
    }

    fn cell_start(out: &mut String, width: u32, shading: Option<&str>) {
        out.push_str(&format!(
            r#"<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>"#
        ));
        if let Some(fill) = shading {
            out.push_str(&format!(
                r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                fill.trim_start_matches('#')
            ));
        }
        out.push_str("</w:tcPr>");
    }

    fn width(&self, table: &str) -> u32 {
        TEXT_WIDTH_TWIPS / u32::from(*self.cols.get(table).unwrap_or(&1)).max(1)
    }

    /// Fecha a célula aberta e completa a linha com células vazias.
    fn close_row(&mut self, out: &mut String) {
        if let Some((table, _, col)) = &self.open {
            out.push_str("</w:tc>");
            let cols = *self.cols.get(table).unwrap_or(&1);
            for _ in col + 1..cols {
                Self::cell_start(out, self.width(table), None);
                out.push_str("<w:p/></w:tc>");
            }
            out.push_str("</w:tr>");
        }
    }

    fn before(&mut self, out: &mut String, p: &Paragraph) {
        let cell = p.attrs.cell.as_ref();
        let same_table = matches!((&self.open, cell), (Some((t, ..)), Some(c)) if *t == c.table);
        if !same_table {
            self.finish(out);
            if let Some(c) = cell {
                let cols = *self.cols.get(&c.table).unwrap_or(&1);
                out.push_str(r#"<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>"#);
                for _ in 0..cols {
                    out.push_str(&format!(r#"<w:gridCol w:w="{}"/>"#, self.width(&c.table)));
                }
                out.push_str("</w:tblGrid><w:tr>");
                self.open_cell(out, c, 0, p);
            }
            return;
        }
        let (Some(c), Some((_, row, col))) = (cell, self.open.clone()) else {
            return;
        };
        if (c.row, c.col) == (row, col) {
            return; // outro parágrafo da mesma célula
        }
        if c.row != row {
            self.close_row(out);
            // Linhas puladas (não deveria haver) viram linhas vazias.
            let cols = *self.cols.get(&c.table).unwrap_or(&1);
            for _ in row + 1..c.row.max(row + 1) {
                out.push_str("<w:tr>");
                for _ in 0..cols {
                    Self::cell_start(out, self.width(&c.table), None);
                    out.push_str("<w:p/></w:tc>");
                }
                out.push_str("</w:tr>");
            }
            out.push_str("<w:tr>");
            self.open_cell(out, c, 0, p);
        } else {
            out.push_str("</w:tc>");
            self.open_cell(out, c, col + 1, p);
        }
    }

    /// Abre a célula `c`, com células vazias antes dela a partir de `from`.
    fn open_cell(
        &mut self,
        out: &mut String,
        c: &nova_domain_text::CellRef,
        from: u16,
        p: &Paragraph,
    ) {
        for _ in from..c.col {
            Self::cell_start(out, self.width(&c.table), None);
            out.push_str("<w:p/></w:tc>");
        }
        Self::cell_start(out, self.width(&c.table), p.attrs.shading.as_deref());
        self.open = Some((c.table.clone(), c.row, c.col));
    }

    /// Fecha a tabela aberta; devolve se havia uma.
    fn finish(&mut self, out: &mut String) -> bool {
        if self.open.is_none() {
            return false;
        }
        self.close_row(out);
        out.push_str("</w:tbl>");
        self.open = None;
        true
    }
}

fn body_xml(
    paragraphs: &[Paragraph],
    images: &[(String, String, Vec<u8>)],
    page: nova_domain_text::PageSetup,
    notes: &[(String, String)],
) -> (String, Vec<Num>, Vec<String>) {
    let mut links: Vec<String> = Vec::new();
    let mut nums = vec![Num::Bullet];
    let mut out = String::from(DOC_START);
    let mut previous_list: Option<ListKind> = None;
    let mut current_number_id = 0;
    let mut table = TableWriter::new(paragraphs);
    // Sumário: as entradas ficam dentro de um campo TOC, como no Word.
    let text_width = page
        .width
        .saturating_sub(page.margin_left + page.margin_right)
        .max(1440);
    let mut toc_open = false;
    for (index, p) in paragraphs.iter().enumerate() {
        table.before(&mut out, p);
        out.push_str("<w:p>");
        let mut ppr = String::new();
        let a = &p.attrs;
        match a.toc {
            Some(entry) if entry.level == 0 => ppr.push_str(r#"<w:pStyle w:val="TOCHeading"/>"#),
            Some(entry) => ppr.push_str(&format!(r#"<w:pStyle w:val="TOC{}"/>"#, entry.level)),
            None => {
                if let Some(id) = style_id(p.style) {
                    ppr.push_str(&format!(r#"<w:pStyle w:val="{id}"/>"#));
                }
            }
        }
        if a.page_break_before {
            ppr.push_str("<w:pageBreakBefore/>");
        }
        if let Some(kind) = a.list {
            let num_id = match kind {
                ListKind::Bullet => 1,
                ListKind::Number => {
                    if previous_list != Some(ListKind::Number) {
                        nums.push(Num::Number);
                        current_number_id = nums.len();
                    }
                    current_number_id
                }
            };
            ppr.push_str(&format!(
                r#"<w:numPr><w:ilvl w:val="{}"/><w:numId w:val="{num_id}"/></w:numPr>"#,
                a.indent.min(MAX_INDENT)
            ));
        }
        previous_list = a.list;
        // Na tabela, o sombreamento é da célula (w:tcPr).
        if let (Some(fill), None) = (&a.shading, &a.cell) {
            ppr.push_str(&format!(
                r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                fill.trim_start_matches('#')
            ));
        }
        if a.line_spacing.is_some() || a.space_before.is_some() || a.space_after.is_some() {
            ppr.push_str("<w:spacing");
            if let Some(pt) = a.space_before {
                ppr.push_str(&format!(r#" w:before="{}""#, u32::from(pt) * 20));
            }
            if let Some(pt) = a.space_after {
                ppr.push_str(&format!(r#" w:after="{}""#, u32::from(pt) * 20));
            }
            if let Some(percent) = a.line_spacing {
                ppr.push_str(&format!(
                    r#" w:line="{}" w:lineRule="auto""#,
                    u32::from(percent) * 240 / 100
                ));
            }
            ppr.push_str("/>");
        }
        if a.toc.is_some_and(|t| t.level > 0) {
            ppr.push_str(&format!(
                r#"<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{text_width}"/></w:tabs>"#
            ));
        }
        if a.list.is_none() && a.indent > 0 {
            ppr.push_str(&format!(
                r#"<w:ind w:left="{}"/>"#,
                u32::from(a.indent) * INDENT_TWIPS
            ));
        }
        match a.align {
            Align::Left => {}
            Align::Center => ppr.push_str(r#"<w:jc w:val="center"/>"#),
            Align::Right => ppr.push_str(r#"<w:jc w:val="right"/>"#),
            Align::Justify => ppr.push_str(r#"<w:jc w:val="both"/>"#),
        }
        if !ppr.is_empty() {
            out.push_str("<w:pPr>");
            out.push_str(&ppr);
            out.push_str("</w:pPr>");
        }
        let toc_entry = a.toc.filter(|t| t.level > 0);
        if toc_entry.is_some() && !toc_open {
            out.push_str(TOC_FIELD_BEGIN);
            toc_open = true;
        }
        if let Some(image) = &p.attrs.image {
            if let Some(index) = images.iter().position(|(id, ..)| *id == image.id) {
                drawing_xml(&mut out, image, index);
            }
        }
        // Trechos vizinhos com o mesmo link ficam num só w:hyperlink.
        let mut open_link: Option<&str> = None;
        for span in &p.spans {
            let link = link_of(span);
            if link != open_link {
                if open_link.is_some() {
                    out.push_str("</w:hyperlink>");
                }
                if let Some(href) = link {
                    let index = links.iter().position(|l| l == href).unwrap_or_else(|| {
                        links.push(href.to_string());
                        links.len() - 1
                    });
                    out.push_str(&format!(r#"<w:hyperlink r:id="rId{}">"#, index + 10));
                }
                open_link = link;
            }
            if let Some(id) = span.marks.iter().find_map(|m| match m {
                Mark::Footnote { id } => Some(id),
                _ => None,
            }) {
                // Chamada de nota: w:footnoteReference com o número da nota (1, 2…).
                if let Some(n) = notes.iter().position(|(i, _)| i == id) {
                    let calls = span
                        .text
                        .chars()
                        .filter(|c| *c == nova_domain_text::FOOTNOTE_CHAR)
                        .count();
                    for _ in 0..calls {
                        out.push_str(&format!(
                            r#"<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="{}"/></w:r>"#,
                            n + 1
                        ));
                    }
                }
                continue;
            }
            run_xml(&mut out, span);
        }
        if open_link.is_some() {
            out.push_str("</w:hyperlink>");
        }
        if let Some(entry) = toc_entry {
            out.push_str(&format!(
                "<w:r><w:tab/></w:r><w:r><w:t>{}</w:t></w:r>",
                entry.page.max(1)
            ));
        }
        let next_is_entry = paragraphs
            .get(index + 1)
            .is_some_and(|n| n.attrs.toc.is_some_and(|t| t.level > 0));
        if toc_open && !next_is_entry {
            out.push_str(r#"<w:r><w:fldChar w:fldCharType="end"/></w:r>"#);
            toc_open = false;
        }
        out.push_str("</w:p>");
    }
    if table.finish(&mut out) {
        // O Word exige um parágrafo depois da última tabela do documento.
        out.push_str("<w:p/>");
    }
    let orient = if page.width > page.height {
        r#" w:orient="landscape""#
    } else {
        ""
    };
    out.push_str(&format!(
        r#"<w:sectPr><w:pgSz w:w="{}" w:h="{}"{orient}/><w:pgMar w:top="{}" w:right="{}" w:bottom="{}" w:left="{}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>"#,
        page.width, page.height, page.margin_top, page.margin_right, page.margin_bottom, page.margin_left
    ));
    (out, nums, links)
}

/// Início do campo do Sumário (títulos 1 a 3, com links), antes do resultado.
const TOC_FIELD_BEGIN: &str = r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#;

/// Um `w:r`, com as propriedades na ordem que o esquema do Word exige.
fn run_xml(out: &mut String, span: &Span) {
    let mut rpr = String::new();
    let find = |kind: &str| span.marks.iter().find(|m| mark_key(m) == kind);
    if find("link").is_some() {
        rpr.push_str(r#"<w:rStyle w:val="Hyperlink"/>"#);
    }
    if let Some(Mark::FontFamily { value }) = find("fontFamily") {
        let v = esc(value);
        rpr.push_str(&format!(
            r#"<w:rFonts w:ascii="{v}" w:hAnsi="{v}" w:cs="{v}" w:eastAsia="{v}"/>"#
        ));
    }
    if find("bold").is_some() {
        rpr.push_str("<w:b/><w:bCs/>");
    }
    if find("italic").is_some() {
        rpr.push_str("<w:i/><w:iCs/>");
    }
    if find("strike").is_some() {
        rpr.push_str("<w:strike/>");
    }
    if let Some(Mark::Color { value }) = find("color") {
        rpr.push_str(&format!(
            r#"<w:color w:val="{}"/>"#,
            value.trim_start_matches('#')
        ));
    }
    if let Some(Mark::FontSize { half_points }) = find("fontSize") {
        rpr.push_str(&format!(
            r#"<w:sz w:val="{half_points}"/><w:szCs w:val="{half_points}"/>"#
        ));
    }
    if let Some(Mark::Highlight { value }) = find("highlight") {
        rpr.push_str(&format!(r#"<w:highlight w:val="{value}"/>"#));
    }
    if find("underline").is_some() {
        rpr.push_str(r#"<w:u w:val="single"/>"#);
    }
    if let Some(Mark::VertAlign { value }) = find("vertAlign") {
        rpr.push_str(&format!(r#"<w:vertAlign w:val="{value}"/>"#));
    }
    out.push_str("<w:r>");
    if !rpr.is_empty() {
        out.push_str("<w:rPr>");
        out.push_str(&rpr);
        out.push_str("</w:rPr>");
    }
    // Tabulações e quebras de linha são elementos próprios no Word.
    let mut chunk = String::new();
    let flush = |out: &mut String, chunk: &mut String| {
        if !chunk.is_empty() {
            out.push_str(&format!(
                r#"<w:t xml:space="preserve">{}</w:t>"#,
                esc(chunk)
            ));
            chunk.clear();
        }
    };
    for ch in span.text.chars() {
        match ch {
            '\t' => {
                flush(out, &mut chunk);
                out.push_str("<w:tab/>");
            }
            '\u{b}' | '\n' => {
                flush(out, &mut chunk);
                out.push_str("<w:br/>");
            }
            c => chunk.push(c),
        }
    }
    flush(out, &mut chunk);
    out.push_str("</w:r>");
}

fn mark_key(mark: &Mark) -> &'static str {
    mark.kind().key()
}

fn numbering_xml(nums: &[Num]) -> String {
    const BULLETS: [&str; 3] = ["•", "◦", "▪"];
    let mut out = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#,
    );
    // Abstrato 0: marcadores; 1: numeração 1. → a. → i.
    out.push_str(
        r#"<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>"#,
    );
    for lvl in 0..=u32::from(MAX_INDENT) {
        let b = BULLETS[lvl as usize % 3];
        out.push_str(&format!(
            r#"<w:lvl w:ilvl="{lvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="{b}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{}" w:hanging="360"/></w:pPr></w:lvl>"#,
            (lvl + 1) * INDENT_TWIPS
        ));
    }
    out.push_str("</w:abstractNum>");
    out.push_str(
        r#"<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>"#,
    );
    for lvl in 0..=u32::from(MAX_INDENT) {
        let fmt = ["decimal", "lowerLetter", "lowerRoman"][lvl as usize % 3];
        out.push_str(&format!(
            r#"<w:lvl w:ilvl="{lvl}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="%{}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{}" w:hanging="360"/></w:pPr></w:lvl>"#,
            lvl + 1,
            (lvl + 1) * INDENT_TWIPS
        ));
    }
    out.push_str("</w:abstractNum>");
    for (i, num) in nums.iter().enumerate() {
        let id = i + 1;
        match num {
            Num::Bullet => out.push_str(&format!(
                r#"<w:num w:numId="{id}"><w:abstractNumId w:val="0"/></w:num>"#
            )),
            Num::Number => {
                out.push_str(&format!(
                    r#"<w:num w:numId="{id}"><w:abstractNumId w:val="1"/>"#
                ));
                for lvl in 0..=MAX_INDENT {
                    out.push_str(&format!(
                        r#"<w:lvlOverride w:ilvl="{lvl}"><w:startOverride w:val="1"/></w:lvlOverride>"#
                    ));
                }
                out.push_str("</w:num>");
            }
        }
    }
    out.push_str("</w:numbering>");
    out
}

const DOC_START: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>"#;

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/><Default Extension="webp" ContentType="image/webp"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>"#;

const DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#;

const APP_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>NovaOffice</Application></Properties>"#;

const CORE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>NovaOffice</dc:creator></cp:coreProperties>"#;

/// Estilos com os nomes internos do Word ("heading 1"…), que ele traduz para
/// "Título 1" na interface em português. Tamanhos iguais aos do Nova Text.
const STYLES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="4A4A46"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="220"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="440"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC4"><w:name w:val="toc 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="660"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC5"><w:name w:val="toc 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="880"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="TOC6"><w:name w:val="toc 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="1100"/></w:pPr></w:style></w:styles>"#;

// ---------------------------------------------------------------- abrir

pub fn import(client: ClientId, bytes: &[u8]) -> Result<TextDocument, AppError> {
    let (paragraphs, media, page, header_footer, notes) = read_document(bytes)?;
    let mut doc = TextDocument::from_paragraphs(client, &paragraphs)?;
    for (id, mime, data) in media {
        doc.put_media(&id, &mime, &data)?;
    }
    if let Some(page) = page.filter(|p| p.validate().is_ok()) {
        doc.load_page_setup(page)?;
    }
    if header_footer != Default::default() && header_footer.validate().is_ok() {
        doc.load_header_footer(header_footer)?;
    }
    if !notes.is_empty() {
        doc.load_footnotes(&notes)?;
    }
    Ok(doc)
}

/// Arquivo embutido lido de um documento: (id, tipo, bytes).
pub(crate) type Media = (String, String, Vec<u8>);

fn part_bytes(zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<Vec<u8>> {
    let mut file = zip.by_name(name).ok()?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).ok()?;
    Some(data)
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::InvalidFile(msg.into())
}

fn part(zip: &mut ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Option<String>, AppError> {
    let mut file = match zip.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(invalid(format!("{name}: {e}"))),
    };
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|e| invalid(format!("{name}: {e}")))?;
    Ok(Some(text))
}

/// Valor de um atributo pelo nome local (`w:val` → `val`).
fn attr(e: &BytesStart, name: &[u8]) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        (a.key.local_name().as_ref() == name).then(|| {
            a.unescape_value()
                .map(|v| v.into_owned())
                .unwrap_or_default()
        })
    })
}

/// Estilo do Nova a partir do id e do nome de um estilo do Word.
fn style_from(id: &str, name: &str) -> Option<BlockStyle> {
    let name = name.to_lowercase();
    let level = name
        .strip_prefix("heading ")
        .or_else(|| name.strip_prefix("título "))
        .or_else(|| name.strip_prefix("titulo "))
        .and_then(|n| n.trim().parse::<u8>().ok())
        .or_else(|| id.strip_prefix("Heading").and_then(|n| n.parse().ok()))
        .or_else(|| id.strip_prefix("Ttulo").and_then(|n| n.parse().ok()));
    if let Some(level) = level {
        return Some(match level {
            1 => BlockStyle::Heading1,
            2 => BlockStyle::Heading2,
            3 => BlockStyle::Heading3,
            4 => BlockStyle::Heading4,
            5 => BlockStyle::Heading5,
            _ => BlockStyle::Heading6,
        });
    }
    if name == "title" || name == "título" {
        return Some(BlockStyle::Heading1);
    }
    if name.contains("quote") || name.contains("citação") || name == "citacao" {
        return Some(BlockStyle::Quote);
    }
    if name == "code" || name.contains("código") || name == "html preformatted" {
        return Some(BlockStyle::Code);
    }
    None
}

/// Nível de Sumário de um estilo pelo nome interno do Word ("toc 1" a "toc 9",
/// "TOC Heading" = 0). Níveis acima de 6 ficam no 6.
fn toc_level(name: &str) -> Option<u8> {
    let name = name.to_lowercase();
    if name == "toc heading" {
        return Some(0);
    }
    let level: u8 = name.strip_prefix("toc ")?.trim().parse().ok()?;
    (level >= 1).then(|| level.min(nova_domain_text::MAX_TOC_LEVEL))
}

/// Tira o número de página do fim de uma entrada de sumário ("Introdução\t3").
pub(crate) fn take_toc_page(p: &mut Paragraph) -> u16 {
    let text = p.text();
    let Some(tab) = text.rfind('\t') else {
        return 0;
    };
    let tail = text[tab + 1..].trim();
    if tail.chars().count() > 12 {
        return 0;
    }
    let page = tail.parse().unwrap_or(0);
    // Corta os trechos no tab (o tab e o número saem).
    let mut left = tab;
    p.spans.retain_mut(|span| {
        if left == 0 {
            return false;
        }
        if span.text.len() > left {
            span.text.truncate(left);
        }
        left -= span.text.len();
        true
    });
    p.spans.retain(|span| !span.text.is_empty());
    page
}

/// Um elemento de propriedade (`w:b`, `w:sz`, `w:jc`…) com os atributos pelo
/// nome local. Os estilos guardam as propriedades assim e as reaplicam em cada
/// parágrafo e trecho, na ordem do Word: padrões do documento, estilo do
/// parágrafo (com os estilos em que se baseia), estilo de caractere e, por
/// último, a formatação direta.
#[derive(Debug, Clone)]
struct Prop {
    name: Vec<u8>,
    attrs: Vec<(Vec<u8>, String)>,
}

impl Prop {
    fn from(e: &BytesStart) -> Prop {
        Prop {
            name: e.local_name().as_ref().to_vec(),
            attrs: e
                .attributes()
                .flatten()
                .map(|a| {
                    (
                        a.key.local_name().as_ref().to_vec(),
                        a.unescape_value()
                            .map(|v| v.into_owned())
                            .unwrap_or_default(),
                    )
                })
                .collect(),
        }
    }

    fn get(&self, key: &[u8]) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn num<T: std::str::FromStr>(&self, key: &[u8]) -> Option<T> {
        self.get(key).and_then(|v| v.parse().ok())
    }

    /// `<w:b/>` liga; `<w:b w:val="0"/>` ou `false` desliga.
    fn on(&self) -> bool {
        !matches!(self.get(b"val"), Some("0" | "false" | "off" | "none"))
    }
}

/// Fontes do tema (`w:asciiTheme="minorHAnsi"` aponta para elas).
#[derive(Default)]
struct ThemeFonts {
    major: Option<String>,
    minor: Option<String>,
}

fn read_theme(xml: &str) -> ThemeFonts {
    let mut fonts = ThemeFonts::default();
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut which: Option<bool> = None; // Some(true) = major
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"majorFont" => which = Some(true),
                b"minorFont" => which = Some(false),
                b"latin" => {
                    let face = attr(&e, b"typeface").filter(|f| !f.is_empty());
                    match which {
                        Some(true) if fonts.major.is_none() => fonts.major = face,
                        Some(false) if fonts.minor.is_none() => fonts.minor = face,
                        _ => {}
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) if matches!(e.local_name().as_ref(), b"majorFont" | b"minorFont") => {
                which = None
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    fonts
}

#[derive(Default, Clone)]
struct StyleInfo {
    /// Estilo do Nova equivalente (Título 1, Citação…); `None` para os demais.
    style: Option<BlockStyle>,
    /// Estilo de Sumário ("toc 1"… e "TOC Heading" = 0).
    toc: Option<u8>,
    num: Option<(u32, u8)>,
    based_on: Option<String>,
    rpr: Vec<Prop>,
    ppr: Vec<Prop>,
}

/// Estilos do documento e, na chave vazia, os padrões (`w:docDefaults`).
struct Styles {
    by_id: HashMap<String, StyleInfo>,
    defaults: StyleInfo,
    /// Estilo dos parágrafos sem `w:pStyle` (o "Normal").
    default_para: Option<String>,
}

impl Styles {
    /// O estilo e os que ele herda, do mais básico ao próprio.
    fn chain(&self, id: Option<&str>) -> Vec<&StyleInfo> {
        let mut chain = Vec::new();
        let mut next = id.map(str::to_string).or_else(|| self.default_para.clone());
        while let Some(id) = next.take() {
            let Some(info) = self.by_id.get(&id) else {
                break;
            };
            if chain.len() >= 16 {
                break; // herança circular num arquivo malformado
            }
            chain.push(info);
            next = info.based_on.clone();
        }
        chain.reverse();
        chain
    }

    fn info(&self, id: Option<&str>) -> StyleInfo {
        let chain = self.chain(id);
        StyleInfo {
            style: chain.iter().rev().find_map(|s| s.style),
            num: chain.iter().rev().find_map(|s| s.num),
            toc: chain.last().and_then(|s| s.toc),
            ..StyleInfo::default()
        }
    }
}

fn read_styles(xml: &str) -> Styles {
    let mut by_id = HashMap::new();
    let mut defaults = StyleInfo::default();
    let mut default_para = None;
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    // Estilo sendo lido: id, nome, informações.
    let mut current: Option<(String, String, StyleInfo)> = None;
    let mut num_lvl: (Option<u32>, u8) = (None, 0);
    let (mut in_defaults, mut in_rpr, mut in_ppr) = (false, false, false);
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(event @ (Event::Start(_) | Event::Empty(_))) => {
                let (Event::Start(ref e) | Event::Empty(ref e)) = event else {
                    unreachable!()
                };
                let empty = matches!(event, Event::Empty(_));
                match e.local_name().as_ref() {
                    b"docDefaults" if !empty => in_defaults = true,
                    b"style" => {
                        num_lvl = (None, 0);
                        if attr(e, b"type").as_deref() == Some("paragraph")
                            && matches!(attr(e, b"default").as_deref(), Some("1" | "true"))
                        {
                            default_para = attr(e, b"styleId");
                        }
                        current = Some((
                            attr(e, b"styleId").unwrap_or_default(),
                            String::new(),
                            StyleInfo::default(),
                        ));
                    }
                    b"name" if !in_rpr && !in_ppr => {
                        if let Some(c) = current.as_mut() {
                            c.1 = attr(e, b"val").unwrap_or_default();
                        }
                    }
                    b"basedOn" => {
                        if let Some(c) = current.as_mut() {
                            c.2.based_on = attr(e, b"val");
                        }
                    }
                    b"rPr" if !empty => in_rpr = true,
                    b"pPr" if !empty => in_ppr = true,
                    b"ilvl" if in_ppr => {
                        num_lvl.1 = attr(e, b"val").and_then(|v| v.parse().ok()).unwrap_or(0)
                    }
                    b"numId" if in_ppr => num_lvl.0 = attr(e, b"val").and_then(|v| v.parse().ok()),
                    _ if in_rpr || in_ppr => {
                        let target = match current.as_mut() {
                            Some(c) => Some(&mut c.2),
                            None if in_defaults => Some(&mut defaults),
                            None => None,
                        };
                        if let Some(t) = target {
                            if in_rpr {
                                t.rpr.push(Prop::from(e));
                            } else {
                                t.ppr.push(Prop::from(e));
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"docDefaults" => in_defaults = false,
                b"rPr" => in_rpr = false,
                b"pPr" => in_ppr = false,
                b"style" => {
                    if let Some((id, name, mut info)) = current.take() {
                        info.style = style_from(&id, &name);
                        info.toc = toc_level(&name);
                        info.num = num_lvl.0.map(|n| (n, num_lvl.1));
                        by_id.insert(id, info);
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    Styles {
        by_id,
        defaults,
        default_para,
    }
}

/// `<w:titlePg/>` liga; `w:val="0"` desliga.
fn toggle_on(e: &BytesStart) -> bool {
    !matches!(attr(e, b"val").as_deref(), Some("0" | "false" | "off"))
}

/// Parágrafo dentro de uma célula: a célula e o sombreamento dela.
fn place_in_cell(
    p: &mut Paragraph,
    cell: &Option<nova_domain_text::CellRef>,
    shading: &Option<String>,
) {
    if let Some(c) = cell {
        p.attrs.cell = Some(c.clone());
        p.attrs.page_break_before = false;
        if shading.is_some() {
            p.attrs.shading = shading.clone();
        }
    }
}

/// Id da relação → endereço, para os links externos.
/// Relações de um tipo (`…/hyperlink`, `…/image`): id → alvo.
fn read_rels(xml: &str, kind: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e))
                if e.local_name().as_ref() == b"Relationship" =>
            {
                if attr(&e, b"Type").is_some_and(|t| t.ends_with(kind)) {
                    if let (Some(id), Some(target)) = (attr(&e, b"Id"), attr(&e, b"Target")) {
                        out.insert(id, target);
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

/// numId → (nível → é marcador?).
fn read_numbering(xml: &str) -> HashMap<u32, Vec<bool>> {
    let mut abstracts: HashMap<u32, Vec<bool>> = HashMap::new();
    let mut nums: HashMap<u32, u32> = HashMap::new();
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut abs: Option<u32> = None;
    let mut lvl: usize = 0;
    let mut num: Option<u32> = None;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"abstractNum" => abs = attr(&e, b"abstractNumId").and_then(|v| v.parse().ok()),
                b"lvl" => lvl = attr(&e, b"ilvl").and_then(|v| v.parse().ok()).unwrap_or(0),
                b"numFmt" => {
                    if let Some(a) = abs {
                        let levels = abstracts.entry(a).or_default();
                        if levels.len() <= lvl {
                            levels.resize(lvl + 1, false);
                        }
                        levels[lvl] = attr(&e, b"val").as_deref() == Some("bullet");
                    }
                }
                b"num" => num = attr(&e, b"numId").and_then(|v| v.parse().ok()),
                b"abstractNumId" => {
                    if let (Some(n), Some(a)) = (num, attr(&e, b"val").and_then(|v| v.parse().ok()))
                    {
                        nums.insert(n, a);
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"abstractNum" => abs = None,
                b"num" => num = None,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    nums.into_iter()
        .map(|(n, a)| (n, abstracts.get(&a).cloned().unwrap_or_default()))
        .collect()
}

#[derive(Default, Clone)]
struct RunProps {
    marks: Vec<Mark>,
    /// Texto elevado/rebaixado (`w:position`, como o LibreOffice grava sub/sobrescrito):
    /// o tamanho menor que vem junto já faz parte do efeito e não vira marca.
    positioned: bool,
}

impl RunProps {
    fn set(&mut self, mark: Mark) {
        self.marks.retain(|m| m.kind() != mark.kind());
        self.marks.push(mark);
    }
    fn unset(&mut self, key: &str) {
        self.marks.retain(|m| m.kind().key() != key);
    }
    fn toggle(&mut self, on: bool, mark: Mark) {
        if on {
            self.set(mark)
        } else {
            self.unset(mark.kind().key())
        }
    }

    /// Aplica uma propriedade de caractere (`w:rPr`).
    fn apply(&mut self, p: &Prop, theme: &ThemeFonts) {
        match p.name.as_slice() {
            b"b" => self.toggle(p.on(), Mark::Bold),
            b"i" => self.toggle(p.on(), Mark::Italic),
            b"strike" | b"dstrike" => self.toggle(p.on(), Mark::Strike),
            b"u" => self.toggle(p.on(), Mark::Underline),
            b"rFonts" => {
                let face = p
                    .get(b"ascii")
                    .or_else(|| p.get(b"hAnsi"))
                    .map(str::to_string)
                    .or_else(
                        || match p.get(b"asciiTheme").or_else(|| p.get(b"hAnsiTheme"))? {
                            t if t.starts_with("major") => theme.major.clone(),
                            _ => theme.minor.clone(),
                        },
                    );
                if let Some(value) = face.filter(|f| !f.is_empty()) {
                    self.set(Mark::FontFamily { value });
                }
            }
            b"position" => {
                let v = p.num::<i32>(b"val").unwrap_or(0);
                if v != 0 {
                    let value = if v < 0 { "subscript" } else { "superscript" };
                    self.set(Mark::VertAlign {
                        value: value.to_string(),
                    });
                    self.unset("fontSize");
                    self.positioned = true;
                }
            }
            b"sz" if !self.positioned => {
                if let Some(v) = p.num::<u16>(b"val").filter(|v| (2..=3276).contains(v)) {
                    self.set(Mark::FontSize { half_points: v });
                }
            }
            b"color" => match p.get(b"val") {
                Some(v) if v.len() == 6 && v.chars().all(|c| c.is_ascii_hexdigit()) => {
                    if v == "000000" {
                        self.unset("color");
                    } else {
                        self.set(Mark::Color {
                            value: format!("#{}", v.to_uppercase()),
                        });
                    }
                }
                // "auto": a cor que contrasta com o fundo, que é o padrão do Nova.
                _ => self.unset("color"),
            },
            b"highlight" => match p.get(b"val") {
                Some(v) if HIGHLIGHT_COLORS.contains(&v) => self.set(Mark::Highlight {
                    value: v.to_string(),
                }),
                _ => self.unset("highlight"),
            },
            b"vertAlign" => match p.get(b"val") {
                Some(v @ ("superscript" | "subscript")) => self.set(Mark::VertAlign {
                    value: v.to_string(),
                }),
                _ => self.unset("vertAlign"),
            },
            _ => {}
        }
    }
}

/// Aplica uma propriedade de parágrafo (`w:pPr`).
fn apply_para(attrs: &mut nova_domain_text::ParaAttrs, p: &Prop) {
    match p.name.as_slice() {
        b"jc" => {
            attrs.align = match p.get(b"val") {
                Some("center") => Align::Center,
                Some("right" | "end") => Align::Right,
                Some("both" | "distribute") => Align::Justify,
                _ => Align::Left,
            }
        }
        b"ind" => {
            if let Some(left) = p.num::<i64>(b"left").or_else(|| p.num(b"start")) {
                attrs.indent =
                    ((left.max(0) as f64 / f64::from(INDENT_TWIPS)).round() as u8).min(MAX_INDENT);
            }
        }
        b"spacing" => {
            // Com "autospacing" ligado, o Word ignora o valor e usa o espaço automático (14 pt).
            let auto = |k: &[u8]| matches!(p.get(k), Some("1" | "true" | "on"));
            if let Some(b) = p.num::<u32>(b"before") {
                attrs.space_before = Some((b / 20).min(1584) as u16);
            }
            if auto(b"beforeAutospacing") {
                attrs.space_before = Some(14);
            }
            if let Some(a) = p.num::<u32>(b"after") {
                attrs.space_after = Some((a / 20).min(1584) as u16);
            }
            if auto(b"afterAutospacing") {
                attrs.space_after = Some(14);
            }
            if let (Some(l), None | Some("auto")) = (p.num::<u32>(b"line"), p.get(b"lineRule")) {
                let percent = (l * 100 / 240).clamp(50, 500) as u16;
                attrs.line_spacing = (percent != 100).then_some(percent);
            }
        }
        b"pageBreakBefore" => attrs.page_break_before = p.on(),
        b"shd" => {
            attrs.shading = p
                .get(b"fill")
                .filter(|v| v.len() == 6 && v.chars().all(|c| c.is_ascii_hexdigit()))
                .map(|v| format!("#{}", v.to_uppercase()))
                .filter(|v| v != "#FFFFFF");
        }
        _ => {}
    }
}

/// Valores que já são o padrão do Nova Text e não precisam virar marca.
const DEFAULT_FONT: &str = "Calibri";
const DEFAULT_HALF_POINTS: u16 = 22;

#[cfg(test)]
fn read_paragraphs(bytes: &[u8]) -> Result<Vec<Paragraph>, AppError> {
    Ok(read_document(bytes)?.0)
}

/// O que se lê de um .docx: parágrafos, imagens e a página.
type Document = (
    Vec<Paragraph>,
    Vec<Media>,
    Option<nova_domain_text::PageSetup>,
    nova_domain_text::HeadersFooters,
    Vec<(String, String)>,
);

fn read_document(bytes: &[u8]) -> Result<Document, AppError> {
    let mut zip =
        ZipArchive::new(Cursor::new(bytes)).map_err(|e| invalid(format!("não é um .docx: {e}")))?;
    let document =
        part(&mut zip, "word/document.xml")?.ok_or_else(|| invalid("word/document.xml ausente"))?;
    let theme = part(&mut zip, "word/theme/theme1.xml")?
        .map(|x| read_theme(&x))
        .unwrap_or_default();
    let styles = part(&mut zip, "word/styles.xml")?
        .map(|x| read_styles(&x))
        .unwrap_or(Styles {
            by_id: HashMap::new(),
            defaults: StyleInfo::default(),
            default_para: None,
        });
    let numbering = part(&mut zip, "word/numbering.xml")?
        .map(|x| read_numbering(&x))
        .unwrap_or_default();
    let rels = part(&mut zip, "word/_rels/document.xml.rels")?.unwrap_or_default();
    let targets = read_rels(&rels, "/hyperlink");
    // Imagens: id da relação → bytes (o alvo é relativo a word/).
    let pictures: HashMap<String, Vec<u8>> = read_rels(&rels, "/image")
        .into_iter()
        .filter_map(|(rid, target)| {
            let path = match target.strip_prefix('/') {
                Some(absolute) => absolute.to_string(),
                None => format!("word/{target}"),
            };
            part_bytes(&mut zip, &path).map(|data| (rid, data))
        })
        .collect();
    let mut media: Vec<Media> = Vec::new();
    // Cabeçalho e rodapé "default" e "Primeira Página Diferente" (do último w:sectPr).
    // Notas de rodapé: o texto de cada uma, pelo número do w:footnoteReference.
    let footnote_texts = match read_rels(&rels, "/footnotes").values().next() {
        Some(target) => part(
            &mut zip,
            &format!("word/{}", target.trim_start_matches('/')),
        )?
        .map(|x| read_footnotes(&x))
        .unwrap_or_default(),
        None => HashMap::new(),
    };
    let mut notes: Vec<(String, String)> = Vec::new();
    let header_rels = read_rels(&rels, "/header");
    let footer_rels = read_rels(&rels, "/footer");
    let mut header_footer = nova_domain_text::HeadersFooters::default();
    let mut hf_parts: Vec<(bool, String)> = Vec::new();
    // Página: a do último w:sectPr (o do corpo do documento).
    let mut page: Option<nova_domain_text::PageSetup> = None;
    // Imagem sendo lida (w:drawing): profundidade, tamanho em EMU e relação.
    let mut drawing_depth = 0u32;
    let mut drawing: (Option<(u64, u64)>, Option<String>) = (None, None);
    let mut para_images: Vec<nova_domain_text::ImageRef> = Vec::new();
    // Link aberto (w:hyperlink): vale para os trechos dentro dele.
    let mut link: Option<String> = None;

    let mut reader = Reader::from_str(&document);
    let mut buf = Vec::new();
    let mut out: Vec<Paragraph> = Vec::new();
    let mut para: Option<Paragraph> = None;
    let mut para_num: Option<(u32, u8)> = None;
    let mut para_style: Option<String> = None;
    // Formatação que todo trecho do parágrafo herda (padrões + estilo do parágrafo).
    let mut para_run = RunProps::default();
    let mut run = RunProps::default();
    let (mut in_ppr, mut in_rpr, mut in_text) = (false, false, false);
    // Sombreamento de célula de tabela: vale para os parágrafos dela até haver tabelas.
    let mut cell_shading: Option<String> = None;
    let (mut in_tcpr, mut tc_depth) = (false, 0u32);
    // Tabelas: só as de primeiro nível viram tabelas; as aninhadas ficam dentro da célula de fora.
    let (mut tbl_depth, mut table_no) = (0u32, 0u32);
    let (mut row, mut col, mut span) = (0u16, 0u16, 1u16);
    let mut cell: Option<nova_domain_text::CellRef> = None;
    // Trechos que não entram no texto: apagados (controle de alterações), campos, desenhos.
    let mut skip_depth = 0u32;

    // Herança do estilo do parágrafo: atributos e formatação dos trechos.
    let start_style = |para: &mut Option<Paragraph>, para_run: &mut RunProps, id: Option<&str>| {
        let p = para.get_or_insert_with(Paragraph::default);
        *para_run = RunProps::default();
        let chain = styles.chain(id);
        // Estilos com equivalente no Nova (Título, Citação…) já têm a aparência e o
        // espaçamento dele: deles só vale a fonte do documento.
        let mapped = chain.iter().any(|s| s.style.is_some());
        for prop in &styles.defaults.rpr {
            if !(mapped && prop.name == b"sz") {
                para_run.apply(prop, &theme);
            }
        }
        if mapped {
            return;
        }
        for s in &chain {
            for prop in &s.ppr {
                apply_para(&mut p.attrs, prop);
            }
            for prop in &s.rpr {
                para_run.apply(prop, &theme);
            }
        }
    };

    // Estilo, lista e limpeza das marcas que já são o padrão do Nova.
    let finish = |mut p: Paragraph, para_style: Option<&str>, para_num: Option<(u32, u8)>| {
        let info = styles.info(para_style);
        if let Some(style) = info.style {
            p.style = style;
        }
        if let Some(level) = info.toc {
            let page = if level > 0 { take_toc_page(&mut p) } else { 0 };
            p.attrs.toc = Some(nova_domain_text::TocEntry { level, page });
        }
        // Lista: a do parágrafo, ou a herdada do estilo (Lista com Marcadores…).
        if let Some((num_id, lvl)) = para_num.or(info.num) {
            if num_id != 0 {
                let bullet = numbering
                    .get(&num_id)
                    .and_then(|levels| levels.get(lvl as usize).copied())
                    .unwrap_or(true);
                p.attrs.list = Some(if bullet {
                    ListKind::Bullet
                } else {
                    ListKind::Number
                });
                p.attrs.indent = lvl.min(MAX_INDENT);
            }
        }
        // O que já é o padrão do Nova não vira marca.
        let plain = p.style == BlockStyle::Paragraph;
        for span in &mut p.spans {
            span.marks.retain(|m| match m {
                Mark::FontFamily { value } => value != DEFAULT_FONT,
                Mark::FontSize { half_points } => !(plain && *half_points == DEFAULT_HALF_POINTS),
                _ => true,
            });
        }
        p
    };
    // Quebra de página no fim de um parágrafo vale para o seguinte.
    let (mut from_break, mut carry_break) = (false, false);

    let push_text = |para: &mut Option<Paragraph>, run: &RunProps, text: &str| {
        let p = para.get_or_insert_with(Paragraph::default);
        if let Some(last) = p.spans.last_mut() {
            if last.marks == run.marks {
                last.text.push_str(text);
                return;
            }
        }
        p.spans.push(Span {
            text: text.to_string(),
            marks: run.marks.clone(),
        });
    };

    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|e| invalid(format!("XML: {e}")))?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(event, Event::Empty(_));
                let name = e.local_name();
                let name = name.as_ref();
                if skip_depth > 0 {
                    if !empty {
                        skip_depth += 1;
                    }
                    buf.clear();
                    continue;
                }
                if drawing_depth > 0 {
                    if !empty {
                        drawing_depth += 1;
                    }
                    match name {
                        b"extent" if drawing.0.is_none() => {
                            let n = |k: &[u8]| attr(e, k).and_then(|v| v.parse::<u64>().ok());
                            if let (Some(cx), Some(cy)) = (n(b"cx"), n(b"cy")) {
                                drawing.0 = Some((cx, cy));
                            }
                        }
                        b"blip" if drawing.1.is_none() => drawing.1 = attr(e, b"embed"),
                        _ => {}
                    }
                    buf.clear();
                    continue;
                }
                match name {
                    b"headerReference" | b"footerReference"
                        if attr(e, b"type").as_deref().unwrap_or("default") == "default" =>
                    {
                        let header = name == b"headerReference";
                        let rels = if header { &header_rels } else { &footer_rels };
                        if let Some(target) = attr(e, b"id").and_then(|id| rels.get(&id).cloned()) {
                            hf_parts.retain(|(h, _)| *h != header);
                            hf_parts.push((header, target));
                        }
                    }
                    b"titlePg" => header_footer.different_first = toggle_on(e),
                    b"pgSz" => {
                        let n = |k: &[u8]| attr(e, k).and_then(|v| v.parse::<u32>().ok());
                        if let (Some(w), Some(h)) = (n(b"w"), n(b"h")) {
                            let p = page.get_or_insert_with(Default::default);
                            p.width = w;
                            p.height = h;
                        }
                    }
                    b"pgMar" => {
                        // Margens negativas (texto por cima do cabeçalho) contam pelo valor absoluto.
                        let n = |k: &[u8]| {
                            attr(e, k)
                                .and_then(|v| v.parse::<i64>().ok())
                                .map(|v| v.unsigned_abs() as u32)
                        };
                        let p = page.get_or_insert_with(Default::default);
                        if let Some(v) = n(b"top") {
                            p.margin_top = v;
                        }
                        if let Some(v) = n(b"bottom") {
                            p.margin_bottom = v;
                        }
                        if let Some(v) = n(b"left").or_else(|| n(b"start")) {
                            p.margin_left = v;
                        }
                        if let Some(v) = n(b"right").or_else(|| n(b"end")) {
                            p.margin_right = v;
                        }
                    }
                    b"drawing" if !empty => {
                        drawing_depth = 1;
                        drawing = (None, None);
                    }
                    b"footnoteReference" if skip_depth == 0 => {
                        if let Some(number) = attr(e, b"id") {
                            let id = format!("n{}", notes.len() + 1);
                            let text = footnote_texts.get(&number).cloned().unwrap_or_default();
                            notes.push((id.clone(), text));
                            // A chamada fica sem o sobrescrito do estilo: o número é desenhado à parte.
                            let mut marks: Vec<Mark> = run
                                .marks
                                .iter()
                                .filter(|m| !matches!(m, Mark::VertAlign { .. }))
                                .cloned()
                                .collect();
                            marks.push(Mark::Footnote { id });
                            let p = para.get_or_insert_with(Paragraph::default);
                            p.spans.push(Span {
                                text: nova_domain_text::FOOTNOTE_CHAR.to_string(),
                                marks,
                            });
                        }
                    }
                    b"del" | b"instrText" | b"pict" | b"object" | b"endnoteReference"
                    | b"commentReference"
                        if !empty =>
                    {
                        skip_depth = 1
                    }
                    b"tbl" if !empty => {
                        tbl_depth += 1;
                        if tbl_depth == 1 {
                            table_no += 1;
                            row = u16::MAX; // a primeira w:tr vira a linha 0
                        }
                    }
                    b"tr" if !empty && tbl_depth == 1 => {
                        row = row.wrapping_add(1).min(MAX_TABLE_SIZE - 1);
                        col = 0;
                        span = 0;
                    }
                    b"tc" if !empty => {
                        tc_depth += 1;
                        if tbl_depth == 1 {
                            col = (col + span).min(MAX_TABLE_SIZE - 1);
                            span = 1;
                            cell_shading = None;
                            cell = Some(nova_domain_text::CellRef {
                                table: format!("t{table_no}"),
                                row,
                                col,
                            });
                        }
                    }
                    b"tcPr" if !empty => in_tcpr = true,
                    b"gridSpan" if in_tcpr && tbl_depth == 1 => {
                        span = attr(e, b"val")
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(1)
                            .max(1);
                    }
                    b"shd" if in_tcpr => {
                        if tbl_depth == 1 {
                            let mut attrs = nova_domain_text::ParaAttrs::default();
                            apply_para(&mut attrs, &Prop::from(e));
                            cell_shading = attrs.shading;
                        }
                    }
                    b"p" => {
                        para = Some(Paragraph::default());
                        para_images.clear();
                        para_num = None;
                        para_style = None;
                        start_style(&mut para, &mut para_run, None);
                        if carry_break {
                            if let Some(p) = para.as_mut() {
                                p.attrs.page_break_before = true;
                            }
                            carry_break = false;
                        }
                        if empty {
                            let mut p = para.take().unwrap_or_default();
                            place_in_cell(&mut p, &cell, &cell_shading);
                            out.push(finish(p, None, None));
                        }
                    }
                    b"pPr" if !empty => in_ppr = true,
                    b"rPr" if !empty => in_rpr = true,
                    b"r" => {
                        run = para_run.clone();
                        if let Some(href) = &link {
                            run.set(Mark::Link { href: href.clone() });
                        }
                    }
                    b"hyperlink" if !empty => {
                        link = attr(e, b"id")
                            .and_then(|id| targets.get(&id).cloned())
                            .filter(|h| nova_domain_text::is_link(h));
                    }
                    b"pStyle" if in_ppr && !in_rpr => {
                        para_style = attr(e, b"val");
                        // O pStyle vem primeiro no pPr: a formatação direta que segue o sobrepõe.
                        let shading = para.as_ref().and_then(|p| p.attrs.shading.clone());
                        let page_break = para.as_ref().is_some_and(|p| p.attrs.page_break_before);
                        para = Some(Paragraph::default());
                        start_style(&mut para, &mut para_run, para_style.as_deref());
                        if let Some(p) = para.as_mut() {
                            p.attrs.page_break_before |= page_break;
                        }
                        if let (Some(p), Some(_)) = (para.as_mut(), &shading) {
                            if p.attrs.shading.is_none() {
                                p.attrs.shading = shading;
                            }
                        }
                    }
                    b"ilvl" if in_ppr => {
                        let lvl = attr(e, b"val").and_then(|v| v.parse().ok()).unwrap_or(0);
                        para_num = Some((para_num.map_or(0, |n| n.0), lvl));
                    }
                    b"numId" if in_ppr => {
                        let id = attr(e, b"val").and_then(|v| v.parse().ok()).unwrap_or(0);
                        para_num = Some((id, para_num.map_or(0, |n| n.1)));
                    }
                    // Propriedades do parágrafo (o rPr dentro do pPr é da marca de parágrafo).
                    _ if in_ppr && !in_rpr => {
                        if let Some(p) = para.as_mut() {
                            apply_para(&mut p.attrs, &Prop::from(e));
                        }
                    }
                    b"rStyle" if in_rpr && !in_ppr => {
                        // O estilo "Hyperlink" (azul sublinhado) é a aparência do próprio link.
                        if let Some(id) =
                            attr(e, b"val").filter(|id| id != "Hyperlink" && link.is_none())
                        {
                            for s in styles.chain(Some(&id)) {
                                for prop in &s.rpr {
                                    run.apply(prop, &theme);
                                }
                            }
                        }
                    }
                    _ if in_rpr && !in_ppr => run.apply(&Prop::from(e), &theme),
                    b"t" if !empty => in_text = true,
                    b"tab" if !in_ppr => push_text(&mut para, &run, "\t"),
                    b"br" | b"cr" => {
                        if attr(e, b"type").as_deref() == Some("page") {
                            // Quebra de página no meio do parágrafo: o resto começa na página seguinte.
                            let p = para.get_or_insert_with(Paragraph::default);
                            if p.spans.iter().all(|s| s.text.is_empty()) {
                                p.attrs.page_break_before = true;
                            } else if let Some(p) = para.take() {
                                let attrs = nova_domain_text::ParaAttrs {
                                    page_break_before: true,
                                    list: None,
                                    ..p.attrs.clone()
                                };
                                out.push(finish(p, para_style.as_deref(), para_num));
                                para = Some(Paragraph {
                                    attrs,
                                    ..Paragraph::default()
                                });
                                from_break = true;
                            }
                        } else {
                            push_text(&mut para, &run, "\u{b}");
                        }
                    }
                    b"noBreakHyphen" => push_text(&mut para, &run, "\u{2011}"),
                    _ => {}
                }
            }
            Event::Text(t) if in_text && skip_depth == 0 => {
                let text = t.unescape().map_err(|e| invalid(format!("XML: {e}")))?;
                push_text(&mut para, &run, &text);
            }
            Event::End(e) => {
                if skip_depth > 0 {
                    skip_depth -= 1;
                    buf.clear();
                    continue;
                }
                if drawing_depth > 0 {
                    drawing_depth -= 1;
                    if drawing_depth == 0 {
                        let data = drawing.1.take().and_then(|rid| pictures.get(&rid));
                        if let Some(data) = data.filter(|d| crate::media::sniff_mime(d).is_some()) {
                            let id = crate::media::media_id(data);
                            let size = drawing.0.take().map(|(cx, cy)| {
                                crate::media::fit(
                                    cx as f64 / EMU_PER_PT as f64,
                                    cy as f64 / EMU_PER_PT as f64,
                                    f64::from(nova_domain_text::MAX_IMAGE_PT),
                                )
                            });
                            let (width, height) =
                                size.unwrap_or_else(|| crate::media::initial_size(data));
                            if !media.iter().any(|(m, ..)| *m == id) {
                                let mime = crate::media::sniff_mime(data).unwrap_or("image/png");
                                media.push((id.clone(), mime.to_string(), data.clone()));
                            }
                            para_images.push(nova_domain_text::ImageRef { id, width, height });
                        }
                    }
                    buf.clear();
                    continue;
                }
                match e.local_name().as_ref() {
                    b"t" => in_text = false,
                    b"pPr" => in_ppr = false,
                    b"rPr" => in_rpr = false,
                    b"tcPr" => in_tcpr = false,
                    b"hyperlink" => link = None,
                    b"tc" => {
                        tc_depth = tc_depth.saturating_sub(1);
                    }
                    b"tbl" => {
                        tbl_depth = tbl_depth.saturating_sub(1);
                        if tbl_depth == 0 {
                            cell = None;
                            cell_shading = None;
                        }
                    }
                    b"p" => {
                        let mut p = para.take().unwrap_or_default();
                        place_in_cell(&mut p, &cell, &cell_shading);
                        let mut p = finish(p, para_style.as_deref(), para_num);
                        // Imagens do parágrafo: cada uma num parágrafo próprio, antes do texto.
                        if !para_images.is_empty() {
                            let attrs = nova_domain_text::ParaAttrs {
                                list: None,
                                ..p.attrs.clone()
                            };
                            let text_too = p.spans.iter().any(|s| !s.text.is_empty());
                            let images = std::mem::take(&mut para_images);
                            let last = images.len() - 1;
                            for (i, image) in images.into_iter().enumerate() {
                                if i == last && !text_too {
                                    p.attrs.image = Some(image);
                                    p.attrs.list = None;
                                } else {
                                    out.push(Paragraph {
                                        attrs: nova_domain_text::ParaAttrs {
                                            image: Some(image),
                                            ..attrs.clone()
                                        },
                                        ..Paragraph::default()
                                    });
                                }
                            }
                        }
                        // Parágrafo que só sobrou de uma quebra de página no fim do anterior:
                        // a quebra passa para o próximo parágrafo.
                        if from_break && p.spans.is_empty() && p.attrs.image.is_none() {
                            carry_break = true;
                        } else {
                            out.push(p);
                        }
                        from_break = false;
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    if out.is_empty() {
        out.push(Paragraph::default());
    }
    normalize(&mut out);
    for (header, target) in hf_parts {
        let path = match target.strip_prefix('/') {
            Some(absolute) => absolute.to_string(),
            None => format!("word/{target}"),
        };
        if let Some(xml) = part(&mut zip, &path)? {
            let value = read_header_footer(&xml);
            if header {
                header_footer.header = value;
            } else {
                header_footer.footer = value;
            }
        }
    }
    Ok((out, media, page, header_footer, notes))
}

/// Cores que o Word e o LibreOffice dão aos links.
const LINK_COLORS: &[&str] = &["#0563C1", "#0000FF", "#000080"];

/// Marcas na ordem do núcleo (por nome) e trechos vizinhos iguais unidos.
pub(crate) fn normalize(paragraphs: &mut [Paragraph]) {
    for p in paragraphs {
        let mut spans: Vec<Span> = Vec::with_capacity(p.spans.len());
        for mut span in p.spans.drain(..) {
            // Azul sublinhado é a aparência do link, não formatação própria.
            let styled_link = span.marks.iter().any(|m| matches!(m, Mark::Link { .. }))
                && span.marks.iter().any(|m| {
                    matches!(m, Mark::Color { value } if LINK_COLORS.contains(&value.to_uppercase().as_str()))
                });
            if styled_link {
                span.marks
                    .retain(|m| !matches!(m, Mark::Underline | Mark::Color { .. }));
            }
            span.marks.sort_by_key(|m| m.kind().key());
            if span.text.is_empty() {
                continue;
            }
            match spans.last_mut() {
                Some(last) if last.marks == span.marks => last.text.push_str(&span.text),
                _ => spans.push(span),
            }
        }
        p.spans = spans;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::{ParaAttr, TextCommand};

    fn sample() -> TextDocument {
        let mut doc = TextDocument::from_plain_text(
            1,
            "Relatório\nTexto com negrito e x2\nitem\nsubitem\npasso\nRua A\u{b}São Paulo\tSP",
        );
        let cmds = vec![
            TextCommand::ApplyMark {
                block: 5,
                offset: 0,
                len: 5,
                mark: Mark::Link {
                    href: "https://exemplo.com/a?b=1&c=2".into(),
                },
            },
            TextCommand::SetBlockAttr {
                block: 5,
                attr: ParaAttr::PageBreakBefore(true),
            },
            TextCommand::SetBlockStyle {
                block: 0,
                style: BlockStyle::Heading1,
            },
            TextCommand::SetBlockAttr {
                block: 0,
                attr: ParaAttr::Align(Align::Center),
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 10,
                len: 7,
                mark: Mark::Bold,
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 10,
                len: 7,
                mark: Mark::Color {
                    value: "#C00000".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 21,
                len: 1,
                mark: Mark::VertAlign {
                    value: "superscript".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 0,
                len: 5,
                mark: Mark::Highlight {
                    value: "yellow".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 0,
                len: 5,
                mark: Mark::FontFamily {
                    value: "Arial".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 0,
                len: 5,
                mark: Mark::FontSize { half_points: 28 },
            },
            TextCommand::SetBlockAttr {
                block: 1,
                attr: ParaAttr::LineSpacing(Some(150)),
            },
            TextCommand::SetBlockAttr {
                block: 1,
                attr: ParaAttr::SpaceAfter(Some(12)),
            },
            TextCommand::SetBlockAttr {
                block: 2,
                attr: ParaAttr::List(Some(ListKind::Bullet)),
            },
            TextCommand::SetBlockAttr {
                block: 3,
                attr: ParaAttr::List(Some(ListKind::Bullet)),
            },
            TextCommand::SetBlockAttr {
                block: 3,
                attr: ParaAttr::Indent(1),
            },
            TextCommand::SetBlockAttr {
                block: 4,
                attr: ParaAttr::List(Some(ListKind::Number)),
            },
            TextCommand::SetBlockAttr {
                block: 5,
                attr: ParaAttr::Indent(2),
            },
            TextCommand::SetBlockAttr {
                block: 5,
                attr: ParaAttr::Align(Align::Justify),
            },
        ];
        doc.execute(TextCommand::Batch { commands: cmds }).unwrap();
        doc
    }

    #[test]
    fn ida_e_volta_preserva_tudo() {
        let doc = sample();
        let back = import(2, &export(&doc)).unwrap();
        assert_eq!(back.paragraphs(), doc.paragraphs());
    }

    #[test]
    fn xml_tem_o_que_o_word_espera() {
        let bytes = export(&sample());
        let mut zip = ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let doc = part(&mut zip, "word/document.xml").unwrap().unwrap();
        assert!(doc.contains(r#"<w:pStyle w:val="Heading1"/>"#));
        assert!(doc.contains(r#"<w:jc w:val="center"/>"#));
        // Ordem do esquema: rFonts, b, i, strike, color, sz, highlight, u, vertAlign.
        assert!(doc.contains(r#"<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:highlight w:val="yellow"/></w:rPr>"#));
        assert!(doc.contains(r#"<w:spacing w:after="240" w:line="360" w:lineRule="auto"/>"#));
        assert!(doc.contains("<w:br/>") && doc.contains("<w:tab/>"));
        assert!(doc.contains(r#"<w:ind w:left="1440"/>"#));
        for name in [
            "[Content_Types].xml",
            "word/styles.xml",
            "word/numbering.xml",
            "_rels/.rels",
        ] {
            assert!(part(&mut zip, name).unwrap().is_some(), "{name}");
        }
    }

    #[test]
    fn duas_listas_numeradas_recomecam_do_um() {
        let mut doc = TextDocument::from_plain_text(1, "a\nb\nmeio\nc");
        for b in [0, 1, 3] {
            doc.execute(TextCommand::SetBlockAttr {
                block: b,
                attr: ParaAttr::List(Some(ListKind::Number)),
            })
            .unwrap();
        }
        let bytes = export(&doc);
        let mut zip = ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let body = part(&mut zip, "word/document.xml").unwrap().unwrap();
        assert_eq!(body.matches(r#"<w:numId w:val="2"/>"#).count(), 2);
        assert_eq!(body.matches(r#"<w:numId w:val="3"/>"#).count(), 1);
        let numbering = part(&mut zip, "word/numbering.xml").unwrap().unwrap();
        assert!(numbering.contains(r#"<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>"#));
    }

    /// Um .docx escrito à mão como o Word grava: estilos em português,
    /// numeração herdada do estilo, toggles desligados, texto apagado.
    #[test]
    fn abre_docx_do_word() {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opt = SimpleFileOptions::default();
        let w = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;
        zip.start_file("word/document.xml", opt).unwrap();
        write!(zip, r#"<?xml version="1.0"?><w:document {w}><w:body>
            <w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>Capítulo</w:t></w:r></w:p>
            <w:p><w:r><w:rPr><w:b/><w:i w:val="0"/></w:rPr><w:t xml:space="preserve">Forte </w:t></w:r><w:r><w:t>fim</w:t></w:r><w:del><w:r><w:delText>apagado</w:delText></w:r></w:del><w:ins><w:r><w:t>!</w:t></w:r></w:ins></w:p>
            <w:p><w:r><w:t>H</w:t></w:r><w:r><w:rPr><w:position w:val="-2"/><w:sz w:val="19"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t>O</w:t></w:r></w:p>
            <w:p><w:pPr><w:pStyle w:val="Commarcadores"/></w:pPr><w:r><w:t>item</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr></w:pPr><w:r><w:t>sub</w:t></w:r></w:p>
            <w:tbl><w:tr><w:tc><w:p><w:r><w:t>célula</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            <w:p/>
            <w:sectPr/></w:body></w:document>"#).unwrap();
        zip.start_file("word/styles.xml", opt).unwrap();
        write!(zip, r#"<w:styles {w}><w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Commarcadores"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style></w:styles>"#).unwrap();
        zip.start_file("word/numbering.xml", opt).unwrap();
        write!(zip, r#"<w:numbering {w}><w:abstractNum w:abstractNumId="9"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="9"/></w:num><w:num w:numId="5"><w:abstractNumId w:val="7"/></w:num></w:numbering>"#).unwrap();
        let bytes = zip.finish().unwrap().into_inner();

        let p = read_paragraphs(&bytes).unwrap();
        let texts: Vec<String> = p.iter().map(Paragraph::text).collect();
        assert_eq!(
            texts,
            ["Capítulo", "Forte fim!", "H2O", "item", "sub", "célula", ""]
        );
        assert_eq!(p[0].style, BlockStyle::Heading1);
        assert_eq!(p[1].spans[0].marks, vec![Mark::Bold]);
        assert_eq!(
            p[2].spans[1].marks,
            vec![Mark::VertAlign {
                value: "subscript".into()
            }]
        );
        assert_eq!(p[3].attrs.list, Some(ListKind::Bullet));
        assert_eq!(
            (p[4].attrs.list, p[4].attrs.indent),
            (Some(ListKind::Number), 1)
        );
    }

    /// Como os documentos colados de páginas da Web no Word: estilo "Normal (Web)",
    /// estilo de caractere "Forte", sombreamento escuro e fontes do tema.
    #[test]
    fn herda_formatacao_dos_estilos() {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opt = SimpleFileOptions::default();
        let w = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;
        zip.start_file("word/document.xml", opt).unwrap();
        write!(zip, r#"<?xml version="1.0"?><w:document {w}><w:body>
            <w:p><w:pPr><w:pStyle w:val="NormalWeb"/><w:shd w:val="clear" w:color="auto" w:fill="343541"/><w:spacing w:before="0" w:beforeAutospacing="0" w:after="300" w:afterAutospacing="0"/></w:pPr>
              <w:r><w:rPr><w:rStyle w:val="Forte"/><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/></w:rPr><w:t>Resumo</w:t></w:r></w:p>
            <w:p><w:pPr><w:pStyle w:val="NormalWeb"/></w:pPr><w:r><w:t>web</w:t></w:r></w:p>
            <w:p><w:r><w:t>normal</w:t></w:r></w:p>
            <w:p><w:pPr><w:pStyle w:val="Destaque"/></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>sem negrito</w:t></w:r></w:p>
            <w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr><w:p><w:r><w:t>célula</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            </w:body></w:document>"#).unwrap();
        zip.start_file("word/styles.xml", opt).unwrap();
        write!(zip, r#"<w:styles {w}>
            <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
            <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:color w:val="1F3864"/></w:rPr></w:style>
            <w:style w:type="paragraph" w:styleId="NormalWeb"><w:name w:val="Normal (Web)"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="100" w:beforeAutospacing="1" w:after="100" w:afterAutospacing="1" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:color w:val="auto"/></w:rPr></w:style>
            <w:style w:type="paragraph" w:styleId="Destaque"><w:name w:val="Destaque"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
            <w:style w:type="character" w:styleId="Forte"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
            </w:styles>"#).unwrap();
        zip.start_file("word/theme/theme1.xml", opt).unwrap();
        write!(zip, r#"<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>"#).unwrap();
        let bytes = zip.finish().unwrap().into_inner();

        let p = read_paragraphs(&bytes).unwrap();
        let segoe = Mark::FontFamily {
            value: "Segoe UI".into(),
        };
        let size12 = Mark::FontSize { half_points: 24 };
        // Estilo do parágrafo + estilo de caractere + formatação direta.
        assert_eq!(p[0].spans[0].marks, vec![Mark::Bold, segoe, size12.clone()]);
        assert_eq!(p[0].attrs.shading.as_deref(), Some("#343541"));
        assert_eq!(
            (p[0].attrs.space_before, p[0].attrs.space_after),
            (Some(0), Some(15))
        );
        assert_eq!(p[0].attrs.line_spacing, None);
        // Só o estilo: fonte e tamanho dele, cor "auto" desfaz a cor do Normal.
        assert_eq!(
            p[1].spans[0].marks,
            vec![
                Mark::FontFamily {
                    value: "Times New Roman".into()
                },
                size12
            ]
        );
        assert_eq!(p[1].attrs.space_before, Some(14), "autospacing do Word");
        // Sem pStyle: o estilo padrão (Normal) e a fonte do tema.
        assert_eq!(
            p[2].spans[0].marks,
            vec![
                Mark::Color {
                    value: "#1F3864".into()
                },
                Mark::FontFamily {
                    value: "Aptos".into()
                }
            ]
        );
        assert_eq!(
            p[2].attrs.space_after, None,
            "padrões do documento ficam com os do Nova"
        );
        // Formatação direta desliga o negrito do estilo; o alinhamento vem do estilo.
        assert!(!p[3].spans[0].marks.contains(&Mark::Bold));
        assert_eq!(p[3].attrs.align, Align::Center);
        // Célula sombreada: o parágrafo leva o sombreamento.
        assert_eq!(p[4].attrs.shading.as_deref(), Some("#D9E2F3"));
    }

    #[test]
    fn link_e_quebra_de_pagina_do_word() {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opt = SimpleFileOptions::default();
        let w = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
        zip.start_file("word/document.xml", opt).unwrap();
        write!(zip, r#"<w:document {w}><w:body>
            <w:p><w:r><w:t xml:space="preserve">Veja </w:t></w:r><w:hyperlink r:id="rId7"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>aqui</w:t></w:r></w:hyperlink><w:r><w:br w:type="page"/></w:r></w:p>
            <w:p><w:r><w:t>Página 2</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>Página 3</w:t></w:r></w:p>
            <w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>Página 4</w:t></w:r></w:p>
            </w:body></w:document>"#).unwrap();
        zip.start_file("word/_rels/document.xml.rels", opt).unwrap();
        write!(zip, r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://exemplo.com" TargetMode="External"/></Relationships>"#).unwrap();
        let bytes = zip.finish().unwrap().into_inner();

        let p = read_paragraphs(&bytes).unwrap();
        let texts: Vec<String> = p.iter().map(Paragraph::text).collect();
        assert_eq!(texts, ["Veja aqui", "Página 2", "Página 3", "Página 4"]);
        assert_eq!(
            p[0].spans[1].marks,
            vec![Mark::Link {
                href: "https://exemplo.com".into()
            }]
        );
        let breaks: Vec<bool> = p.iter().map(|p| p.attrs.page_break_before).collect();
        assert_eq!(breaks, [false, true, true, true]);
    }

    #[test]
    fn sombreamento_vai_e_volta() {
        let mut doc = TextDocument::new(1);
        doc.execute(TextCommand::InsertText {
            block: 0,
            offset: 0,
            text: "fundo".into(),
            marks: None,
        })
        .unwrap();
        doc.execute(TextCommand::SetBlockAttr {
            block: 0,
            attr: ParaAttr::Shading(Some("#343541".into())),
        })
        .unwrap();
        let back = import(2, &export(&doc)).unwrap();
        assert_eq!(back.paragraphs(), doc.paragraphs());
    }

    #[test]
    fn arquivo_que_nao_e_docx_vira_erro() {
        assert!(matches!(
            import(1, b"nao sou zip"),
            Err(AppError::InvalidFile(_))
        ));
    }
}

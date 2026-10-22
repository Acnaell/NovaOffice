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
    let (body, nums) = body_xml(&paragraphs);
    let files: [(&str, String); 8] = [
        ("[Content_Types].xml", CONTENT_TYPES.to_string()),
        ("_rels/.rels", ROOT_RELS.to_string()),
        ("docProps/app.xml", APP_XML.to_string()),
        ("docProps/core.xml", CORE_XML.to_string()),
        ("word/_rels/document.xml.rels", DOCUMENT_RELS.to_string()),
        ("word/document.xml", body),
        ("word/styles.xml", STYLES_XML.to_string()),
        ("word/numbering.xml", numbering_xml(&nums)),
    ];
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in files {
        zip.start_file(name, options).expect("zip em memória");
        zip.write_all(content.as_bytes()).expect("zip em memória");
    }
    zip.finish().expect("zip em memória").into_inner()
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

fn body_xml(paragraphs: &[Paragraph]) -> (String, Vec<Num>) {
    let mut nums = vec![Num::Bullet];
    let mut out = String::from(DOC_START);
    let mut previous_list: Option<ListKind> = None;
    let mut current_number_id = 0;
    for p in paragraphs {
        out.push_str("<w:p>");
        let mut ppr = String::new();
        if let Some(id) = style_id(p.style) {
            ppr.push_str(&format!(r#"<w:pStyle w:val="{id}"/>"#));
        }
        let a = &p.attrs;
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
        if let Some(fill) = &a.shading {
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
        for span in &p.spans {
            run_xml(&mut out, span);
        }
        out.push_str("</w:p>");
    }
    out.push_str(DOC_END);
    (out, nums)
}

/// Um `w:r`, com as propriedades na ordem que o esquema do Word exige.
fn run_xml(out: &mut String, span: &Span) {
    let mut rpr = String::new();
    let find = |kind: &str| span.marks.iter().find(|m| mark_key(m) == kind);
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

const DOC_START: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>"#;

/// Página A4 com margens de 2,5 cm, como a página do Nova Text.
const DOC_END: &str = r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>"#;

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>"#;

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>"#;

const DOCUMENT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#;

const APP_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>NovaOffice</Application></Properties>"#;

const CORE_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>NovaOffice</dc:creator></cp:coreProperties>"#;

/// Estilos com os nomes internos do Word ("heading 1"…), que ele traduz para
/// "Título 1" na interface em português. Tamanhos iguais aos do Nova Text.
const STYLES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="4A4A46"/></w:rPr></w:style><w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style></w:styles>"#;

// ---------------------------------------------------------------- abrir

pub fn import(client: ClientId, bytes: &[u8]) -> Result<TextDocument, AppError> {
    let paragraphs = read_paragraphs(bytes)?;
    Ok(TextDocument::from_paragraphs(client, &paragraphs)?)
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

fn read_paragraphs(bytes: &[u8]) -> Result<Vec<Paragraph>, AppError> {
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
                match name {
                    b"del" | b"instrText" | b"drawing" | b"pict" | b"object"
                    | b"footnoteReference" | b"endnoteReference" | b"commentReference"
                        if !empty =>
                    {
                        skip_depth = 1
                    }
                    b"tc" if !empty => {
                        tc_depth += 1;
                        cell_shading = None;
                    }
                    b"tcPr" if !empty => in_tcpr = true,
                    b"shd" if in_tcpr => {
                        let mut attrs = nova_domain_text::ParaAttrs::default();
                        apply_para(&mut attrs, &Prop::from(e));
                        cell_shading = attrs.shading;
                    }
                    b"p" => {
                        para = Some(Paragraph::default());
                        para_num = None;
                        para_style = None;
                        start_style(&mut para, &mut para_run, None);
                        if tc_depth > 0 {
                            if let Some(p) = para.as_mut() {
                                p.attrs.shading = cell_shading.clone();
                            }
                        }
                        if empty {
                            out.push(para.take().unwrap_or_default());
                        }
                    }
                    b"pPr" if !empty => in_ppr = true,
                    b"rPr" if !empty => in_rpr = true,
                    b"r" => run = para_run.clone(),
                    b"pStyle" if in_ppr && !in_rpr => {
                        para_style = attr(e, b"val");
                        // O pStyle vem primeiro no pPr: a formatação direta que segue o sobrepõe.
                        let shading = para.as_ref().and_then(|p| p.attrs.shading.clone());
                        para = Some(Paragraph::default());
                        start_style(&mut para, &mut para_run, para_style.as_deref());
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
                        if let Some(id) = attr(e, b"val") {
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
                            // Quebra de página vira parágrafo novo até o Nova ter páginas.
                            if let Some(p) = para.take() {
                                let attrs = p.attrs.clone();
                                out.push(p);
                                para = Some(Paragraph {
                                    attrs,
                                    ..Paragraph::default()
                                });
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
                match e.local_name().as_ref() {
                    b"t" => in_text = false,
                    b"pPr" => in_ppr = false,
                    b"rPr" => in_rpr = false,
                    b"tcPr" => in_tcpr = false,
                    b"tc" => {
                        tc_depth = tc_depth.saturating_sub(1);
                        cell_shading = None;
                    }
                    b"p" => {
                        let mut p = para.take().unwrap_or_default();
                        let info = styles.info(para_style.as_deref());
                        if let Some(style) = info.style {
                            p.style = style;
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
                                Mark::FontSize { half_points } => {
                                    !(plain && *half_points == DEFAULT_HALF_POINTS)
                                }
                                _ => true,
                            });
                        }
                        out.push(p);
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
    Ok(out)
}

/// Marcas na ordem do núcleo (por nome) e trechos vizinhos iguais unidos.
pub(crate) fn normalize(paragraphs: &mut [Paragraph]) {
    for p in paragraphs {
        let mut spans: Vec<Span> = Vec::with_capacity(p.spans.len());
        for mut span in p.spans.drain(..) {
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

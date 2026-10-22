//! Documento de texto ODF (.odt), o formato do LibreOffice: gravar e abrir.
//!
//! Mesmo conjunto do .docx: estilos de título, citação e código, listas por
//! nível, alinhamento, recuo, espaçamento e marcas de caractere.

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};

use nova_crdt::ClientId;
use nova_domain_text::{
    Align, BlockStyle, ListKind, Mark, ParaAttrs, Paragraph, Span, TextDocument, MAX_INDENT,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

use crate::AppError;

const INDENT_CM: f64 = 1.27;

// ---------------------------------------------------------------- gravar

pub fn export(doc: &TextDocument) -> Vec<u8> {
    let paragraphs = doc.paragraphs();
    let content = content_xml(&paragraphs);
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    // O "mimetype" vem primeiro e sem compressão, como o ODF exige.
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let deflated =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("mimetype", stored).expect("zip em memória");
    zip.write_all(b"application/vnd.oasis.opendocument.text")
        .expect("zip em memória");
    for (name, body) in [
        ("META-INF/manifest.xml", MANIFEST.to_string()),
        ("meta.xml", META.to_string()),
        ("styles.xml", STYLES.to_string()),
        ("content.xml", content),
    ] {
        zip.start_file(name, deflated).expect("zip em memória");
        zip.write_all(body.as_bytes()).expect("zip em memória");
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
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    out
}

/// Texto com espaços repetidos, tabulações e quebras de linha no formato ODF
/// (que junta espaços seguidos se não forem marcados).
fn odf_text(text: &str, at_start: bool) -> String {
    let mut out = String::new();
    let mut spaces = 0usize;
    let mut first = at_start;
    let flush = |out: &mut String, spaces: &mut usize, first: bool| {
        if *spaces == 0 {
            return;
        }
        if first {
            out.push_str(&format!(r#"<text:s text:c="{}"/>"#, *spaces));
        } else {
            out.push(' ');
            if *spaces > 1 {
                out.push_str(&format!(r#"<text:s text:c="{}"/>"#, *spaces - 1));
            }
        }
        *spaces = 0;
    };
    for ch in text.chars() {
        match ch {
            ' ' => spaces += 1,
            '\t' => {
                flush(&mut out, &mut spaces, first);
                out.push_str("<text:tab/>");
                first = false;
            }
            '\u{b}' | '\n' => {
                flush(&mut out, &mut spaces, first);
                out.push_str("<text:line-break/>");
                first = true;
            }
            c => {
                flush(&mut out, &mut spaces, first);
                out.push_str(&esc(&c.to_string()));
                first = false;
            }
        }
    }
    flush(&mut out, &mut spaces, first);
    out
}

const HIGHLIGHT_HEX: [(&str, &str); 15] = [
    ("yellow", "#ffff00"),
    ("green", "#00ff00"),
    ("cyan", "#00ffff"),
    ("magenta", "#ff00ff"),
    ("blue", "#0000ff"),
    ("red", "#ff0000"),
    ("darkBlue", "#000080"),
    ("darkCyan", "#008080"),
    ("darkGreen", "#008000"),
    ("darkMagenta", "#800080"),
    ("darkRed", "#800000"),
    ("darkYellow", "#808000"),
    ("darkGray", "#808080"),
    ("lightGray", "#c0c0c0"),
    ("black", "#000000"),
];

fn text_props(marks: &[Mark]) -> String {
    let mut p = String::new();
    for m in marks {
        match m {
            Mark::Bold => p.push_str(r#" fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold""#),
            Mark::Italic => p.push_str(r#" fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic""#),
            Mark::Underline => p.push_str(r#" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color""#),
            Mark::Strike => p.push_str(r#" style:text-line-through-style="solid""#),
            Mark::FontFamily { value } => p.push_str(&format!(r#" fo:font-family="'{}'""#, esc(value).replace('\'', ""))),
            Mark::FontSize { half_points } => p.push_str(&format!(r#" fo:font-size="{}pt""#, f64::from(*half_points) / 2.0)),
            Mark::Color { value } => p.push_str(&format!(r#" fo:color="{}""#, value.to_lowercase())),
            Mark::Highlight { value } => {
                let hex = HIGHLIGHT_HEX.iter().find(|(n, _)| n == value).map_or("#ffff00", |(_, h)| h);
                p.push_str(&format!(r#" fo:background-color="{hex}""#));
            }
            Mark::VertAlign { value } => p.push_str(if value == "superscript" {
                r#" style:text-position="super 58%""#
            } else {
                r#" style:text-position="sub 58%""#
            }),
        }
    }
    p
}

fn parent_style(style: BlockStyle) -> &'static str {
    match style {
        BlockStyle::Paragraph => "Standard",
        BlockStyle::Heading1 => "Heading_20_1",
        BlockStyle::Heading2 => "Heading_20_2",
        BlockStyle::Heading3 => "Heading_20_3",
        BlockStyle::Heading4 => "Heading_20_4",
        BlockStyle::Heading5 => "Heading_20_5",
        BlockStyle::Heading6 => "Heading_20_6",
        BlockStyle::Quote => "Quotations",
        BlockStyle::Code => "Preformatted_20_Text",
    }
}

fn para_props(a: &ParaAttrs) -> String {
    let mut p = String::new();
    match a.align {
        Align::Left => {}
        Align::Center => p.push_str(r#" fo:text-align="center""#),
        Align::Right => p.push_str(r#" fo:text-align="end""#),
        Align::Justify => p.push_str(r#" fo:text-align="justify""#),
    }
    if a.list.is_none() && a.indent > 0 {
        p.push_str(&format!(
            r#" fo:margin-left="{:.2}cm""#,
            f64::from(a.indent) * INDENT_CM
        ));
    }
    if let Some(pt) = a.space_before {
        p.push_str(&format!(r#" fo:margin-top="{pt}pt""#));
    }
    if let Some(pt) = a.space_after {
        p.push_str(&format!(r#" fo:margin-bottom="{pt}pt""#));
    }
    if let Some(percent) = a.line_spacing {
        p.push_str(&format!(r#" fo:line-height="{percent}%""#));
    }
    p
}

fn content_xml(paragraphs: &[Paragraph]) -> String {
    // Estilos automáticos: um por combinação de parágrafo e de marcas.
    let mut para_styles: Vec<(String, String)> = Vec::new(); // (chave, xml)
    let mut text_styles: Vec<String> = Vec::new();
    let mut body = String::new();

    let para_style_name = |styles: &mut Vec<(String, String)>, p: &Paragraph| -> String {
        let props = para_props(&p.attrs);
        let parent = parent_style(p.style);
        let key = format!("{parent}|{props}");
        let index = styles
            .iter()
            .position(|(k, _)| *k == key)
            .unwrap_or_else(|| {
                styles.push((key, format!(r#"<style:paragraph-properties{props}/>"#)));
                styles.len() - 1
            });
        let _ = parent;
        format!("P{}", index + 1)
    };

    // Pilha de listas abertas: (tipo, nível).
    let mut open: Vec<ListKind> = Vec::new();
    let mut previous_kind: Option<ListKind> = None;
    let close_to = |body: &mut String, open: &mut Vec<ListKind>, depth: usize| {
        while open.len() > depth {
            open.pop();
            body.push_str("</text:list-item></text:list>");
        }
    };

    for p in paragraphs {
        match p.attrs.list {
            Some(kind) => {
                let level = usize::from(p.attrs.indent.min(MAX_INDENT));
                if previous_kind != Some(kind) {
                    close_to(&mut body, &mut open, 0);
                }
                if open.len() > level + 1 {
                    close_to(&mut body, &mut open, level + 1);
                }
                if open.len() == level + 1 {
                    // Mesmo nível: fecha o item anterior e abre outro.
                    body.push_str("</text:list-item><text:list-item>");
                } else {
                    while open.len() < level + 1 {
                        let style = if kind == ListKind::Bullet { "L1" } else { "L2" };
                        if open.is_empty() {
                            body.push_str(&format!(
                                r#"<text:list text:style-name="{style}"><text:list-item>"#
                            ));
                        } else {
                            body.push_str("<text:list><text:list-item>");
                        }
                        open.push(kind);
                    }
                }
                previous_kind = Some(kind);
            }
            None => {
                close_to(&mut body, &mut open, 0);
                previous_kind = None;
            }
        }
        let name = para_style_name(&mut para_styles, p);
        let (open_tag, close_tag) = match p.style.heading_level() {
            Some(level) => (
                format!(r#"<text:h text:style-name="{name}" text:outline-level="{level}">"#),
                "</text:h>",
            ),
            None => (format!(r#"<text:p text:style-name="{name}">"#), "</text:p>"),
        };
        body.push_str(&open_tag);
        let mut at_start = true;
        for span in &p.spans {
            let text = odf_text(&span.text, at_start);
            at_start = span.text.ends_with(['\u{b}', '\n']);
            if span.marks.is_empty() {
                body.push_str(&text);
            } else {
                let props = text_props(&span.marks);
                let index = text_styles
                    .iter()
                    .position(|s| *s == props)
                    .unwrap_or_else(|| {
                        text_styles.push(props.clone());
                        text_styles.len() - 1
                    });
                body.push_str(&format!(
                    r#"<text:span text:style-name="T{}">{text}</text:span>"#,
                    index + 1
                ));
            }
        }
        body.push_str(close_tag);
    }
    close_to(&mut body, &mut open, 0);

    let mut auto = String::new();
    for (i, (key, props)) in para_styles.iter().enumerate() {
        let parent = key.split('|').next().unwrap_or("Standard");
        auto.push_str(&format!(
            r#"<style:style style:name="P{}" style:family="paragraph" style:parent-style-name="{parent}">{props}</style:style>"#,
            i + 1
        ));
    }
    for (i, props) in text_styles.iter().enumerate() {
        auto.push_str(&format!(
            r#"<style:style style:name="T{}" style:family="text"><style:text-properties{props}/></style:style>"#,
            i + 1
        ));
    }
    auto.push_str(&list_styles());

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {NS} office:version="1.3"><office:automatic-styles>{auto}</office:automatic-styles><office:body><office:text>{body}</office:text></office:body></office:document-content>"#
    )
}

fn list_styles() -> String {
    const BULLETS: [&str; 3] = ["•", "◦", "▪"];
    let mut out = String::from(r#"<text:list-style style:name="L1">"#);
    for lvl in 1..=u32::from(MAX_INDENT) + 1 {
        out.push_str(&format!(
            r#"<text:list-level-style-bullet text:level="{lvl}" text:bullet-char="{}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="{:.3}cm"/></style:list-level-properties></text:list-level-style-bullet>"#,
            BULLETS[(lvl as usize - 1) % 3],
            f64::from(lvl) * INDENT_CM
        ));
    }
    out.push_str(r#"</text:list-style><text:list-style style:name="L2">"#);
    for lvl in 1..=u32::from(MAX_INDENT) + 1 {
        let fmt = ["1", "a", "i"][(lvl as usize - 1) % 3];
        out.push_str(&format!(
            r#"<text:list-level-style-number text:level="{lvl}" style:num-suffix="." style:num-format="{fmt}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" fo:text-indent="-0.635cm" fo:margin-left="{:.3}cm"/></style:list-level-properties></text:list-level-style-number>"#,
            f64::from(lvl) * INDENT_CM
        ));
    }
    out.push_str("</text:list-style>");
    out
}

const NS: &str = r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0""#;

const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>"#;

const META: &str = r#"<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"><office:meta><meta:generator>NovaOffice</meta:generator></office:meta></office:document-meta>"#;

/// Estilos comuns com os nomes do LibreOffice ("Heading 1"…, que ele mostra
/// como "Título 1" em português) e os tamanhos do Nova Text.
const STYLES: &str = r##"<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="8pt" fo:line-height="115%"/><style:text-properties fo:font-family="Calibri" fo:font-size="11pt" fo:language="pt" fo:country="BR"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"/><style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="12pt" fo:margin-bottom="6pt" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="1" style:class="text"><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="2" style:class="text"><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="3" style:class="text"><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_4" style:display-name="Heading 4" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="4" style:class="text"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_5" style:display-name="Heading 5" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="5" style:class="text"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_6" style:display-name="Heading 6" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="6" style:class="text"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style><style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm"/><style:text-properties fo:font-style="italic" fo:color="#4a4a46"/></style:style><style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-bottom="0pt" fo:line-height="100%"/><style:text-properties fo:font-family="Consolas" fo:font-size="10pt"/></style:style></office:styles></office:document-styles>"##;

// ---------------------------------------------------------------- abrir

pub fn import(client: ClientId, bytes: &[u8]) -> Result<TextDocument, AppError> {
    let paragraphs = read_paragraphs(bytes)?;
    Ok(TextDocument::from_paragraphs(client, &paragraphs)?)
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::InvalidFile(msg.into())
}

fn attr(e: &BytesStart, name: &[u8]) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        (a.key.local_name().as_ref() == name).then(|| {
            a.unescape_value()
                .map(|v| v.into_owned())
                .unwrap_or_default()
        })
    })
}

/// Propriedades de um estilo (automático ou comum), já com o pai resolvido depois.
#[derive(Default, Clone)]
struct OdfStyle {
    parent: Option<String>,
    marks: Vec<Mark>,
    attrs: ParaAttrs,
    heading: Option<u8>,
}

fn block_style_for(name: &str) -> Option<BlockStyle> {
    let n = name.to_lowercase().replace("_20_", " ");
    if let Some(level) = n
        .strip_prefix("heading ")
        .and_then(|l| l.trim().parse::<u8>().ok())
    {
        return Some(heading(level));
    }
    if n == "title" {
        return Some(BlockStyle::Heading1);
    }
    if n.contains("quotation") || n.contains("quote") {
        return Some(BlockStyle::Quote);
    }
    if n.contains("preformatted") || n.contains("source") || n == "code" {
        return Some(BlockStyle::Code);
    }
    None
}

fn heading(level: u8) -> BlockStyle {
    match level {
        0 | 1 => BlockStyle::Heading1,
        2 => BlockStyle::Heading2,
        3 => BlockStyle::Heading3,
        4 => BlockStyle::Heading4,
        5 => BlockStyle::Heading5,
        _ => BlockStyle::Heading6,
    }
}

fn length_cm(value: &str) -> Option<f64> {
    let v = value.trim();
    let (num, unit) = v.split_at(
        v.find(|c: char| c.is_ascii_alphabetic() || c == '%')
            .unwrap_or(v.len()),
    );
    let n: f64 = num.parse().ok()?;
    Some(match unit {
        "cm" => n,
        "mm" => n / 10.0,
        "in" => n * 2.54,
        "pt" => n * 2.54 / 72.0,
        "px" => n * 2.54 / 96.0,
        _ => return None,
    })
}

fn length_pt(value: &str) -> Option<u16> {
    length_cm(value).map(|cm| (cm / 2.54 * 72.0).round().clamp(0.0, 1584.0) as u16)
}

fn nearest_highlight(hex: &str) -> Option<String> {
    let rgb = |h: &str| -> Option<[i32; 3]> {
        let h = h.trim_start_matches('#');
        if h.len() != 6 {
            return None;
        }
        Some([0, 2, 4].map(|i| i32::from_str_radix(&h[i..i + 2], 16).unwrap_or(0)))
    };
    let target = rgb(hex)?;
    if hex.eq_ignore_ascii_case("#ffffff") {
        return None;
    }
    HIGHLIGHT_HEX
        .iter()
        .min_by_key(|(_, h)| {
            let c = rgb(h).unwrap_or([0; 3]);
            (0..3).map(|i| (c[i] - target[i]).pow(2)).sum::<i32>()
        })
        .map(|(n, _)| n.to_string())
}

fn apply_text_props(e: &BytesStart, s: &mut OdfStyle) {
    let mut set = |m: Mark| {
        s.marks.retain(|x| x.kind() != m.kind());
        s.marks.push(m);
    };
    if attr(e, b"font-weight").as_deref() == Some("bold")
        || attr(e, b"font-weight")
            .and_then(|w| w.parse::<u32>().ok())
            .is_some_and(|w| w >= 600)
    {
        set(Mark::Bold);
    }
    if attr(e, b"font-style").as_deref() == Some("italic") {
        set(Mark::Italic);
    }
    if attr(e, b"text-underline-style").is_some_and(|v| v != "none") {
        set(Mark::Underline);
    }
    if attr(e, b"text-line-through-style").is_some_and(|v| v != "none") {
        set(Mark::Strike);
    }
    if let Some(f) = attr(e, b"font-family").or_else(|| attr(e, b"font-name")) {
        let f = f.trim_matches(['\'', '"']).to_string();
        if !f.is_empty() {
            set(Mark::FontFamily { value: f });
        }
    }
    if let Some(size) = attr(e, b"font-size").filter(|v| v.ends_with("pt")) {
        if let Ok(pt) = size.trim_end_matches("pt").parse::<f64>() {
            let half = (pt * 2.0).round() as u16;
            if (2..=3276).contains(&half) {
                set(Mark::FontSize { half_points: half });
            }
        }
    }
    if let Some(c) = attr(e, b"color").filter(|c| c.len() == 7 && c.starts_with('#')) {
        if !c.eq_ignore_ascii_case("#000000") {
            set(Mark::Color {
                value: c.to_uppercase(),
            });
        }
    }
    if let Some(bg) = attr(e, b"background-color").and_then(|c| nearest_highlight(&c)) {
        set(Mark::Highlight { value: bg });
    }
    if let Some(pos) = attr(e, b"text-position") {
        let first = pos.split_whitespace().next().unwrap_or("0");
        let value = match first {
            "super" => Some("superscript"),
            "sub" => Some("subscript"),
            n => n
                .trim_end_matches('%')
                .parse::<f64>()
                .ok()
                .filter(|v| *v != 0.0)
                .map(|v| if v > 0.0 { "superscript" } else { "subscript" }),
        };
        if let Some(v) = value {
            set(Mark::VertAlign {
                value: v.to_string(),
            });
        }
    }
}

fn apply_para_props(e: &BytesStart, s: &mut OdfStyle) {
    let a = &mut s.attrs;
    match attr(e, b"text-align").as_deref() {
        Some("center") => a.align = Align::Center,
        Some("end" | "right") => a.align = Align::Right,
        Some("justify") => a.align = Align::Justify,
        Some(_) => a.align = Align::Left,
        None => {}
    }
    if let Some(cm) = attr(e, b"margin-left").and_then(|v| length_cm(&v)) {
        a.indent = ((cm / INDENT_CM).round().max(0.0) as u8).min(MAX_INDENT);
    }
    if let Some(pt) = attr(e, b"margin-top").and_then(|v| length_pt(&v)) {
        a.space_before = Some(pt);
    }
    if let Some(pt) = attr(e, b"margin-bottom").and_then(|v| length_pt(&v)) {
        a.space_after = Some(pt);
    }
    if let Some(lh) = attr(e, b"line-height").filter(|v| v.ends_with('%')) {
        if let Ok(p) = lh.trim_end_matches('%').parse::<f64>() {
            let p = p.round().clamp(50.0, 500.0) as u16;
            if p != 100 {
                a.line_spacing = Some(p);
            }
        }
    }
}

/// Estilos de um XML (styles.xml ou content.xml) e os estilos de lista
/// (nome → nível → é marcador?).
fn read_styles(
    xml: &str,
    styles: &mut HashMap<String, OdfStyle>,
    lists: &mut HashMap<String, Vec<bool>>,
) {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut current: Option<(String, OdfStyle)> = None;
    let mut list: Option<String> = None;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"style" => {
                    let name = attr(&e, b"name").unwrap_or_default();
                    let s = OdfStyle {
                        parent: attr(&e, b"parent-style-name"),
                        heading: attr(&e, b"default-outline-level").and_then(|v| v.parse().ok()),
                        ..OdfStyle::default()
                    };
                    current = Some((name, s));
                }
                b"text-properties" => {
                    if let Some((_, s)) = current.as_mut() {
                        apply_text_props(&e, s);
                    }
                }
                b"paragraph-properties" => {
                    if let Some((_, s)) = current.as_mut() {
                        apply_para_props(&e, s);
                    }
                }
                b"list-style" => list = attr(&e, b"name"),
                b"list-level-style-bullet"
                | b"list-level-style-number"
                | b"list-level-style-image" => {
                    if let Some(name) = &list {
                        let level: usize =
                            attr(&e, b"level").and_then(|v| v.parse().ok()).unwrap_or(1);
                        let levels = lists.entry(name.clone()).or_default();
                        if levels.len() < level {
                            levels.resize(level, true);
                        }
                        levels[level - 1] = e.local_name().as_ref() != b"list-level-style-number";
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"style" => {
                    if let Some((name, s)) = current.take() {
                        styles.insert(name, s);
                    }
                }
                b"list-style" => list = None,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
}

/// Estilo com os pais resolvidos: marcas e atributos herdados, estilo do Nova.
fn resolve(
    name: &str,
    styles: &HashMap<String, OdfStyle>,
) -> (Vec<Mark>, ParaAttrs, Option<BlockStyle>) {
    let mut chain = Vec::new();
    let mut cur = Some(name.to_string());
    while let Some(n) = cur {
        if chain.len() > 16 || chain.contains(&n) {
            break;
        }
        cur = styles.get(&n).and_then(|s| s.parent.clone());
        chain.push(n);
    }
    let mut block = None;
    for n in &chain {
        if block.is_none() {
            block =
                block_style_for(n).or_else(|| styles.get(n).and_then(|s| s.heading).map(heading));
        }
    }
    // Atributos e marcas: só os do próprio estilo automático (o comum dá o estilo do Nova).
    let own = styles.get(name).cloned().unwrap_or_default();
    (own.marks, own.attrs, block)
}

fn read_paragraphs(bytes: &[u8]) -> Result<Vec<Paragraph>, AppError> {
    let mut zip =
        ZipArchive::new(Cursor::new(bytes)).map_err(|e| invalid(format!("não é um .odt: {e}")))?;
    let mut read = |name: &str| -> Result<Option<String>, AppError> {
        match zip.by_name(name) {
            Ok(mut f) => {
                let mut s = String::new();
                f.read_to_string(&mut s)
                    .map_err(|e| invalid(format!("{name}: {e}")))?;
                Ok(Some(s))
            }
            Err(zip::result::ZipError::FileNotFound) => Ok(None),
            Err(e) => Err(invalid(format!("{name}: {e}"))),
        }
    };
    let content = read("content.xml")?.ok_or_else(|| invalid("content.xml ausente"))?;
    let mut styles = HashMap::new();
    let mut lists = HashMap::new();
    if let Some(s) = read("styles.xml")? {
        read_styles(&s, &mut styles, &mut lists);
    }
    read_styles(&content, &mut styles, &mut lists);

    let mut reader = Reader::from_str(&content);
    let mut buf = Vec::new();
    let mut out = Vec::new();
    let mut in_body = false;
    let mut para: Option<Paragraph> = None;
    // Pilha de marcas dos text:span abertos.
    let mut span_marks: Vec<Vec<Mark>> = Vec::new();
    // Pilha de listas: estilo de lista da lista externa e profundidade.
    let mut list_stack: Vec<Option<String>> = Vec::new();
    let mut skip = 0u32;

    let push = |para: &mut Option<Paragraph>, marks: &[Vec<Mark>], text: &str| {
        let p = para.get_or_insert_with(Paragraph::default);
        let marks = marks.last().cloned().unwrap_or_default();
        p.spans.push(Span {
            text: text.to_string(),
            marks,
        });
    };

    loop {
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|e| invalid(format!("XML: {e}")))?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(event, Event::Empty(_));
                if skip > 0 {
                    if !empty {
                        skip += 1;
                    }
                    buf.clear();
                    continue;
                }
                match e.local_name().as_ref() {
                    b"text" if e.name().as_ref() == b"office:text" => in_body = true,
                    _ if !in_body => {}
                    b"note" | b"frame" | b"annotation" | b"tracked-changes" | b"sequence-decls"
                        if !empty =>
                    {
                        skip = 1
                    }
                    b"list" => {
                        let style =
                            attr(e, b"style-name").or_else(|| list_stack.last().cloned().flatten());
                        if !empty {
                            list_stack.push(style);
                        }
                    }
                    b"p" | b"h" => {
                        let style_name = attr(e, b"style-name").unwrap_or_default();
                        let (marks, mut attrs, block) = resolve(&style_name, &styles);
                        let mut style = block.unwrap_or(BlockStyle::Paragraph);
                        if e.local_name().as_ref() == b"h" {
                            let level = attr(e, b"outline-level")
                                .and_then(|v| v.parse().ok())
                                .unwrap_or(1);
                            style = heading(level);
                        }
                        if let Some(list_style) = list_stack.first().cloned().flatten() {
                            let depth = list_stack.len() - 1;
                            let bullet = lists
                                .get(&list_style)
                                .and_then(|l| l.get(depth).copied())
                                .unwrap_or(true);
                            attrs.list = Some(if bullet {
                                ListKind::Bullet
                            } else {
                                ListKind::Number
                            });
                            attrs.indent = (depth as u8).min(MAX_INDENT);
                        } else if !list_stack.is_empty() {
                            attrs.list = Some(ListKind::Bullet);
                            attrs.indent = ((list_stack.len() - 1) as u8).min(MAX_INDENT);
                        }
                        para = Some(Paragraph {
                            style,
                            attrs,
                            spans: Vec::new(),
                        });
                        span_marks = vec![marks];
                        if empty {
                            out.push(para.take().unwrap_or_default());
                        }
                    }
                    b"span" => {
                        let style_name = attr(e, b"style-name").unwrap_or_default();
                        let (own, _, _) = resolve(&style_name, &styles);
                        let mut marks = span_marks.last().cloned().unwrap_or_default();
                        for m in own {
                            marks.retain(|x| x.kind() != m.kind());
                            marks.push(m);
                        }
                        if !empty {
                            span_marks.push(marks);
                        }
                    }
                    b"tab" => push(&mut para, &span_marks, "\t"),
                    b"line-break" => push(&mut para, &span_marks, "\u{b}"),
                    b"s" => {
                        let n: usize = attr(e, b"c").and_then(|v| v.parse().ok()).unwrap_or(1);
                        push(&mut para, &span_marks, &" ".repeat(n.min(1000)));
                    }
                    _ => {}
                }
            }
            Event::Text(t) if in_body && skip == 0 && para.is_some() => {
                let raw = t.unescape().map_err(|e| invalid(format!("XML: {e}")))?;
                // Espaços em branco do XML se juntam num só (regra do ODF).
                let mut text = String::new();
                let mut last_space = false;
                for ch in raw.chars() {
                    if ch.is_whitespace() {
                        if !last_space {
                            text.push(' ');
                        }
                        last_space = true;
                    } else {
                        text.push(ch);
                        last_space = false;
                    }
                }
                if !text.is_empty() {
                    push(&mut para, &span_marks, &text);
                }
            }
            Event::End(e) => {
                if skip > 0 {
                    skip -= 1;
                    buf.clear();
                    continue;
                }
                match e.local_name().as_ref() {
                    b"text" if e.name().as_ref() == b"office:text" => in_body = false,
                    b"list" => {
                        list_stack.pop();
                    }
                    b"span" => {
                        if span_marks.len() > 1 {
                            span_marks.pop();
                        }
                    }
                    b"p" | b"h" => {
                        if let Some(p) = para.take() {
                            out.push(p);
                        }
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
    crate::docx::normalize(&mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::{ParaAttr, TextCommand};

    fn sample() -> TextDocument {
        let mut doc = TextDocument::from_plain_text(
            1,
            "Relatório\n  dois  espaços e negrito\nitem\nsub\npasso\nmeio\nnovo\nRua A\u{b}São Paulo\tSP",
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
                offset: 17,
                len: 7,
                mark: Mark::Bold,
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 17,
                len: 7,
                mark: Mark::Color {
                    value: "#C00000".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 2,
                len: 4,
                mark: Mark::Highlight {
                    value: "yellow".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 2,
                len: 4,
                mark: Mark::VertAlign {
                    value: "subscript".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 2,
                len: 4,
                mark: Mark::FontFamily {
                    value: "Arial".into(),
                },
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 2,
                len: 4,
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
                block: 6,
                attr: ParaAttr::List(Some(ListKind::Number)),
            },
            TextCommand::SetBlockAttr {
                block: 7,
                attr: ParaAttr::Indent(2),
            },
            TextCommand::SetBlockAttr {
                block: 7,
                attr: ParaAttr::Align(Align::Right),
            },
            TextCommand::ApplyMark {
                block: 7,
                offset: 0,
                len: 3,
                mark: Mark::Underline,
            },
            TextCommand::ApplyMark {
                block: 7,
                offset: 0,
                len: 3,
                mark: Mark::Italic,
            },
            TextCommand::ApplyMark {
                block: 7,
                offset: 0,
                len: 3,
                mark: Mark::Strike,
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
    fn mimetype_primeiro_e_sem_compressao() {
        let bytes = export(&sample());
        assert_eq!(&bytes[30..38], b"mimetype");
        let mut zip = ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let f = zip.by_index(0).unwrap();
        assert_eq!(f.name(), "mimetype");
        assert_eq!(f.compression(), zip::CompressionMethod::Stored);
    }

    #[test]
    fn arquivo_invalido_vira_erro() {
        assert!(matches!(import(1, b"x"), Err(AppError::InvalidFile(_))));
    }
}

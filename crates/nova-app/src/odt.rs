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

use crate::{design, AppError};

const INDENT_CM: f64 = 1.27;

// ---------------------------------------------------------------- gravar

pub fn export(doc: &TextDocument) -> Vec<u8> {
    let paragraphs = doc.paragraphs();
    // Imagens usadas: id → (caminho no pacote, tipo, bytes).
    let mut pictures: HashMap<String, (String, String, Vec<u8>)> = HashMap::new();
    for image in paragraphs.iter().filter_map(|p| p.attrs.image.as_ref()) {
        if !pictures.contains_key(&image.id) {
            if let Some((mime, data)) = doc.media(&image.id) {
                let path = format!("Pictures/{}.{}", image.id, crate::media::extension(&mime));
                pictures.insert(image.id.clone(), (path, mime, data));
            }
        }
    }
    let paths: HashMap<String, String> = pictures
        .iter()
        .map(|(id, (path, ..))| (id.clone(), path.clone()))
        .collect();
    let content = content_xml(&paragraphs, &paths, &doc.footnotes(), &doc.comments());
    let mut manifest = MANIFEST
        .trim_end_matches("</manifest:manifest>")
        .to_string();
    let mut sorted: Vec<_> = pictures.values().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    for (path, mime, _) in &sorted {
        manifest.push_str(&format!(
            r#"<manifest:file-entry manifest:full-path="{path}" manifest:media-type="{mime}"/>"#
        ));
    }
    manifest.push_str("</manifest:manifest>");
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    // O "mimetype" vem primeiro e sem compressão, como o ODF exige.
    let stored = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let deflated =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("mimetype", stored).expect("zip em memória");
    zip.write_all(b"application/vnd.oasis.opendocument.text")
        .expect("zip em memória");
    for (name, body) in [
        ("META-INF/manifest.xml", manifest),
        ("meta.xml", META.to_string()),
        (
            "styles.xml",
            styles_xml(
                &doc.page_setup(),
                &doc.header_footer(),
                doc.watermark().as_ref(),
            ),
        ),
        ("content.xml", content),
    ] {
        zip.start_file(name, deflated).expect("zip em memória");
        zip.write_all(body.as_bytes()).expect("zip em memória");
    }
    for (path, _, data) in sorted {
        zip.start_file(path.as_str(), stored)
            .expect("zip em memória");
        zip.write_all(data).expect("zip em memória");
    }
    zip.finish().expect("zip em memória").into_inner()
}

/// Estilos fixos mais a página (papel, margens, cor e borda), o cabeçalho e o
/// rodapé e a marca d'água do documento.
/// Distância do cabeçalho e do rodapé à beira do papel (twips), a mesma do .docx.
const HEADER_FOOTER_DISTANCE: u32 = 708;
/// Parte da altura do cabeçalho que não é espaçamento (0,1 cm, como o LibreOffice).
const HEADER_FOOTER_LINE: u32 = 57;

fn styles_xml(
    page: &nova_domain_text::PageSetup,
    hf: &nova_domain_text::HeadersFooters,
    watermark: Option<&nova_domain_text::Watermark>,
) -> String {
    let cm = |twips: u32| format!("{:.3}cm", f64::from(twips) / 1440.0 * 2.54);
    let orientation = if page.width > page.height {
        "landscape"
    } else {
        "portrait"
    };
    let align = |a: Align| match a {
        Align::Left => "start",
        Align::Center => "center",
        Align::Right => "end",
        Align::Justify => "justify",
    };
    // Cabeçalho e rodapé no estilo de página: campos de número e total de páginas.
    let mut styles = String::new();
    let mut master = String::new();
    let mut layout_extra = String::new();
    // Margens gravadas no estilo de página (sem o cabeçalho e o rodapé).
    let mut outer_page = page.clone();
    // A marca d'água fica no cabeçalho (também no da primeira página), atrás do texto.
    let mut shape = String::new();
    if let Some(w) = watermark {
        styles.push_str(&design::odt_watermark_style(w));
        shape = design::odt_watermark(w, page);
    }
    for (tag, name, value) in [("header", "MP1", &hf.header), ("footer", "MP2", &hf.footer)] {
        let shape = if tag == "header" { shape.as_str() } else { "" };
        if value.text.is_empty() && shape.is_empty() {
            continue;
        }
        styles.push_str(&format!(
            r#"<style:style style:name="{name}" style:family="paragraph"><style:paragraph-properties fo:text-align="{}"/></style:style>"#,
            align(value.align)
        ));
        // Como o LibreOffice grava um .docx: a margem do estilo de página vai até o
        // cabeçalho (a distância do Word) e o cabeçalho ocupa o resto da margem do
        // Nova, com o espaçamento dinâmico. Assim o texto começa onde começa no Nova.
        let (margin, outer) = if tag == "header" {
            ("fo:margin-bottom", &mut outer_page.margin_top)
        } else {
            ("fo:margin-top", &mut outer_page.margin_bottom)
        };
        let distance = HEADER_FOOTER_DISTANCE.min(*outer / 2);
        let height = *outer - distance;
        *outer = distance;
        layout_extra.push_str(&format!(
            r#"<style:{tag}-style><style:header-footer-properties fo:min-height="{}" {margin}="{}" style:dynamic-spacing="true"/></style:{tag}-style>"#,
            cm(height),
            cm(height.saturating_sub(HEADER_FOOTER_LINE))
        ));
        let mut body = shape.to_string();
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
            body.push_str(&odf_text(text, body.len() == shape.len()));
            match field {
                Some(f) => {
                    body.push_str(if f == nova_domain_text::PAGE_FIELD {
                        r#"<text:page-number text:select-page="current">1</text:page-number>"#
                    } else {
                        "<text:page-count>1</text:page-count>"
                    });
                    rest = &rest[text.len() + f.len()..];
                }
                None => rest = "",
            }
        }
        master.push_str(&format!(
            r#"<style:{tag}><text:p text:style-name="{name}">{body}</text:p></style:{tag}>"#
        ));
        if hf.different_first {
            // Primeira página com cabeçalho/rodapé vazio (um parágrafo vazio, como o LibreOffice grava).
            master.push_str(&format!(
                r#"<style:{tag}-first><text:p text:style-name="{name}">{shape}</text:p></style:{tag}-first>"#
            ));
        }
    }
    // Estilos do Sumário: tab à direita com pontilhado na largura do texto.
    let text_width = cm(page
        .width
        .saturating_sub(page.margin_left + page.margin_right)
        .max(1440));
    let mut contents = String::from(
        r#"<style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:class="index"><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>"#,
    );
    for level in 1..=nova_domain_text::MAX_TOC_LEVEL {
        contents.push_str(&format!(
            r#"<style:style style:name="Contents_20_{level}" style:display-name="Contents {level}" style:family="paragraph" style:parent-style-name="Standard" style:class="index"><style:paragraph-properties fo:margin-left="{:.2}cm" fo:margin-bottom="5pt"><style:tab-stops><style:tab-stop style:position="{text_width}" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>"#,
            f64::from(level - 1) * 0.39
        ));
    }
    // Cor e borda (aba Design); com borda, parte da margem vira enchimento.
    let (design_props, margins) = design::odt_page_props(&outer_page);
    let layout = format!(
        r#"<office:automatic-styles>{styles}<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="{}" fo:page-height="{}" style:print-orientation="{orientation}" fo:margin-top="{}" fo:margin-bottom="{}" fo:margin-left="{}" fo:margin-right="{}"{design_props}/>{layout_extra}</style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">{master}</style:master-page></office:master-styles></office:document-styles>"#,
        cm(page.width),
        cm(page.height),
        cm(margins[0]),
        cm(margins[1]),
        cm(margins[2]),
        cm(margins[3])
    );
    STYLES
        .replacen(
            "</office:styles>",
            &format!("{contents}</office:styles>"),
            1,
        )
        .replacen("</office:document-styles>", &layout, 1)
}

/// Cabeçalho e rodapé do primeiro estilo de página mestre do styles.xml.
fn read_header_footer(
    xml: &str,
    styles: &HashMap<String, OdfStyle>,
) -> nova_domain_text::HeadersFooters {
    let mut out = nova_domain_text::HeadersFooters::default();
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    // Parte sendo lida: Some(true) = cabeçalho, Some(false) = rodapé.
    let mut part: Option<bool> = None;
    let mut first_part = false;
    let mut in_master = false;
    let mut paragraphs = 0;
    while let Ok(event) = reader.read_event_into(&mut buf) {
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(event, Event::Empty(_));
                match e.local_name().as_ref() {
                    b"master-page" if !in_master && !empty => in_master = true,
                    b"header" | b"footer" if in_master && !empty && part.is_none() => {
                        part = Some(e.local_name().as_ref() == b"header");
                        paragraphs = 0;
                    }
                    b"header-first" | b"footer-first" if in_master => {
                        first_part = !empty;
                        out.different_first = true;
                    }
                    // Formas (marca d'água) não são texto do cabeçalho.
                    b"custom-shape" | b"frame" if part.is_some() && !empty => {
                        part_skip(&mut reader);
                    }
                    b"p" | b"h" if part.is_some() && !first_part => {
                        let header = part == Some(true);
                        let target = if header {
                            &mut out.header
                        } else {
                            &mut out.footer
                        };
                        if paragraphs == 0 {
                            if let Some(name) = attr(e, b"style-name") {
                                target.align = resolve(&name, styles).1.align;
                            }
                        } else if !target.text.is_empty() {
                            target.text.push('\u{b}');
                        }
                        paragraphs += 1;
                    }
                    b"page-number" if part.is_some() && !first_part => {
                        let target = if part == Some(true) {
                            &mut out.header
                        } else {
                            &mut out.footer
                        };
                        target.text.push_str(nova_domain_text::PAGE_FIELD);
                        if !empty {
                            part_skip(&mut reader);
                        }
                    }
                    b"page-count" if part.is_some() && !first_part => {
                        let target = if part == Some(true) {
                            &mut out.header
                        } else {
                            &mut out.footer
                        };
                        target.text.push_str(nova_domain_text::NUMPAGES_FIELD);
                        if !empty {
                            part_skip(&mut reader);
                        }
                    }
                    b"s" if part.is_some() && !first_part => {
                        let n: usize = attr(e, b"c").and_then(|v| v.parse().ok()).unwrap_or(1);
                        let target = if part == Some(true) {
                            &mut out.header
                        } else {
                            &mut out.footer
                        };
                        target.text.push_str(&" ".repeat(n.min(100)));
                    }
                    b"tab" if part.is_some() && !first_part => {
                        let target = if part == Some(true) {
                            &mut out.header
                        } else {
                            &mut out.footer
                        };
                        target.text.push('\t');
                    }
                    b"line-break" if part.is_some() && !first_part => {
                        let target = if part == Some(true) {
                            &mut out.header
                        } else {
                            &mut out.footer
                        };
                        target.text.push('\u{b}');
                    }
                    _ => {}
                }
            }
            Event::Text(t) if part.is_some() && !first_part => {
                let value = t.unescape().map(|v| v.into_owned()).unwrap_or_default();
                let target = if part == Some(true) {
                    &mut out.header
                } else {
                    &mut out.footer
                };
                target.text.push_str(&value);
            }
            Event::End(e) => match e.local_name().as_ref() {
                b"header" | b"footer" => part = None,
                b"header-first" | b"footer-first" => first_part = false,
                b"master-page" if in_master => break,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    for hf in [&mut out.header, &mut out.footer] {
        hf.text = hf.text.trim_matches('\u{b}').chars().take(1000).collect();
    }
    out
}

/// Pula até o fim do elemento aberto (o valor de um campo).
fn part_skip(reader: &mut Reader<&[u8]>) {
    let mut depth = 1;
    let mut buf = Vec::new();
    while depth > 0 {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(_)) => depth += 1,
            Ok(Event::End(_)) => depth -= 1,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
}

/// Página do styles.xml: a do primeiro `style:page-layout-properties` com
/// tamanho (o LibreOffice grava antes um `style:default-page-layout` sem ele).
/// O cabeçalho e o rodapé do LibreOffice ficam dentro da margem (`fo:min-height`):
/// a margem do Nova, como a do Word, vai até o texto e soma essa altura.
fn read_page(xml: &str) -> Option<nova_domain_text::PageSetup> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut page: Option<nova_domain_text::PageSetup> = None;
    // Some(true) = dentro do style:header-style, Some(false) = do style:footer-style.
    let mut part: Option<bool> = None;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"page-layout-properties"
                    if page.is_none() && attr(&e, b"page-width").is_some() =>
                {
                    let twips = |k: &[u8]| {
                        attr(&e, k)
                            .and_then(|v| length_cm(&v))
                            .map(|cm| (cm / 2.54 * 1440.0).round().max(0.0) as u32)
                    };
                    let d = nova_domain_text::PageSetup::default();
                    // Com borda, a margem do Nova (e do Word) vai até o texto: soma borda e enchimento.
                    let (background, border, extra) = design::odt_read_page_props(&e, length_cm);
                    let extra = if border.is_some() { extra } else { [0; 4] };
                    page = Some(nova_domain_text::PageSetup {
                        width: twips(b"page-width")?,
                        height: twips(b"page-height")?,
                        margin_top: twips(b"margin-top").unwrap_or(d.margin_top) + extra[0],
                        margin_bottom: twips(b"margin-bottom").unwrap_or(d.margin_bottom)
                            + extra[1],
                        margin_left: twips(b"margin-left").unwrap_or(d.margin_left) + extra[2],
                        margin_right: twips(b"margin-right").unwrap_or(d.margin_right) + extra[3],
                        background,
                        border,
                    });
                }
                b"header-style" if page.is_some() => part = Some(true),
                b"footer-style" if page.is_some() => part = Some(false),
                b"header-footer-properties" => {
                    let height = attr(&e, b"min-height")
                        .and_then(|v| length_cm(&v))
                        .map(|cm| (cm / 2.54 * 1440.0).round().max(0.0) as u32)
                        .unwrap_or(0);
                    if let (Some(p), Some(header)) = (page.as_mut(), part) {
                        if header {
                            p.margin_top += height;
                        } else {
                            p.margin_bottom += height;
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"header-style" | b"footer-style" => part = None,
                b"page-layout" if page.is_some() => return page,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => return page,
            _ => {}
        }
        buf.clear();
    }
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
            // O link é o elemento text:a e a nota é text:note, não estilos.
            Mark::Link { .. } | Mark::Footnote { .. } | Mark::Comment { .. } => {}
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
    if let Some(color) = &a.shading {
        p.push_str(&format!(
            r#" fo:background-color="{}""#,
            color.to_lowercase()
        ));
    }
    if a.page_break_before {
        p.push_str(r#" fo:break-before="page""#);
    }
    p
}

fn content_xml(
    paragraphs: &[Paragraph],
    pictures: &HashMap<String, String>,
    notes: &[(String, String)],
    comments: &[(String, nova_domain_text::Comment)],
) -> String {
    // Comentário aberto (office:annotation já escrito): pode atravessar parágrafos.
    let mut open_comment: Option<String> = None;
    let comment_of = |span: &Span| -> Option<String> {
        span.marks.iter().find_map(|m| match m {
            Mark::Comment { id } if comments.iter().any(|(c, _)| c == id) => Some(id.clone()),
            _ => None,
        })
    };
    // Fim do trecho: office:annotation-end e, logo depois, as respostas.
    let close_comment = |body: &mut String, id: &str| {
        body.push_str(&format!(r#"<office:annotation-end office:name="{id}"/>"#));
        for (reply, c) in comments
            .iter()
            .filter(|(_, c)| c.parent.as_deref() == Some(id))
        {
            body.push_str(&crate::comments::odt_annotation(reply, c));
        }
    };
    let mut frames = 0;
    // Estilos automáticos: um por combinação de parágrafo e de marcas.
    let mut para_styles: Vec<(String, String)> = Vec::new(); // (chave, xml)
    let mut text_styles: Vec<String> = Vec::new();
    let mut body = String::new();

    let para_style_name = |styles: &mut Vec<(String, String)>, p: &Paragraph| -> String {
        // Na tabela, o fundo é da célula.
        let attrs = ParaAttrs {
            shading: p.attrs.shading.clone().filter(|_| p.attrs.cell.is_none()),
            ..p.attrs.clone()
        };
        let props = para_props(&attrs);
        let toc_parent = p.attrs.toc.map(|t| match t.level {
            0 => "Contents_20_Heading".to_string(),
            n => format!("Contents_20_{n}"),
        });
        let parent = toc_parent.as_deref().unwrap_or(parent_style(p.style));
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

    // Tabelas: colunas de cada uma, a célula aberta e os estilos de célula (por cor de fundo).
    let mut cols: HashMap<String, u16> = HashMap::new();
    for c in paragraphs.iter().filter_map(|p| p.attrs.cell.as_ref()) {
        let n = cols.entry(c.table.clone()).or_default();
        *n = (*n).max(c.col + 1);
    }
    let mut cell_styles: Vec<Option<String>> = vec![None];
    let mut open_cell: Option<(String, u16, u16)> = None;
    let mut tables = 0;
    let cell_tag = |cell_styles: &mut Vec<Option<String>>, shading: Option<String>| {
        let index = cell_styles
            .iter()
            .position(|s| *s == shading)
            .unwrap_or_else(|| {
                cell_styles.push(shading);
                cell_styles.len() - 1
            });
        format!(r#"<table:table-cell table:style-name="C{index}" office:value-type="string">"#)
    };
    let empty_cells = |body: &mut String, n: u16| {
        for _ in 0..n {
            body.push_str(r#"<table:table-cell table:style-name="C0" office:value-type="string"><text:p/></table:table-cell>"#);
        }
    };

    let mut toc_open = false;
    let mut tocs = 0;
    for (index, p) in paragraphs.iter().enumerate() {
        let cell = p.attrs.cell.as_ref();
        let key = cell.map(|c| (c.table.clone(), c.row, c.col));
        if key != open_cell {
            // Mudou de célula (ou entrou/saiu da tabela): listas não atravessam células.
            close_to(&mut body, &mut open, 0);
            previous_kind = None;
            let same_table =
                matches!((&open_cell, cell), (Some((t, ..)), Some(c)) if *t == c.table);
            if let Some((table, row, col)) = open_cell.take() {
                body.push_str("</table:table-cell>");
                let n = cols.get(&table).copied().unwrap_or(1);
                match cell {
                    Some(c) if same_table && c.row == row => {
                        empty_cells(&mut body, c.col.saturating_sub(col + 1))
                    }
                    _ => {
                        empty_cells(&mut body, n.saturating_sub(col + 1));
                        body.push_str("</table:table-row>");
                        if !same_table {
                            body.push_str("</table:table>");
                        }
                    }
                }
                if let Some(c) = cell.filter(|_| same_table) {
                    if c.row != row {
                        body.push_str("<table:table-row>");
                        empty_cells(&mut body, c.col);
                    }
                }
            }
            if let Some(c) = cell {
                if !same_table {
                    tables += 1;
                    let n = cols.get(&c.table).copied().unwrap_or(1);
                    body.push_str(&format!(
                        r#"<table:table table:name="Tabela{tables}" table:style-name="Tab"><table:table-column table:number-columns-repeated="{n}"/><table:table-row>"#
                    ));
                    empty_cells(&mut body, c.col);
                }
                body.push_str(&cell_tag(&mut cell_styles, p.attrs.shading.clone()));
            }
            open_cell = key;
        }
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
        // Sumário: um text:table-of-content com as entradas no index-body.
        let toc = p.attrs.toc.filter(|_| cell.is_none());
        if toc.is_some() && !toc_open {
            tocs += 1;
            body.push_str(&format!(
                r#"<text:table-of-content text:name="Sumário{tocs}" text:protected="false"><text:table-of-content-source text:outline-level="3">{TOC_TEMPLATES}</text:table-of-content-source><text:index-body>"#
            ));
            toc_open = true;
        }
        let toc_title = toc.is_some_and(|t| t.level == 0);
        if toc_title {
            body.push_str(&format!(
                r#"<text:index-title text:name="Sumário{tocs}_Head">"#
            ));
        }
        let name = para_style_name(&mut para_styles, p);
        let heading_level = p.style.heading_level().filter(|_| toc.is_none());
        let (open_tag, close_tag) = match heading_level {
            Some(level) => (
                format!(r#"<text:h text:style-name="{name}" text:outline-level="{level}">"#),
                "</text:h>",
            ),
            None => (format!(r#"<text:p text:style-name="{name}">"#), "</text:p>"),
        };
        body.push_str(&open_tag);
        if let Some(path) = p
            .attrs
            .image
            .as_ref()
            .and_then(|i| pictures.get(&i.id).map(|path| (i, path)))
        {
            let (image, path) = path;
            frames += 1;
            body.push_str(&format!(
                r#"<draw:frame draw:name="Imagem{frames}" text:anchor-type="as-char" svg:width="{}pt" svg:height="{}pt" draw:z-index="0"><draw:image xlink:href="{path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>"#,
                image.width, image.height
            ));
        }
        let mut at_start = true;
        for span in &p.spans {
            let comment = comment_of(span);
            if comment != open_comment {
                if let Some(id) = &open_comment {
                    close_comment(&mut body, id);
                }
                if let Some(id) = &comment {
                    let c = &comments
                        .iter()
                        .find(|(c, _)| c == id)
                        .expect("comentário")
                        .1;
                    body.push_str(&crate::comments::odt_annotation(id, c));
                }
                open_comment = comment;
            }
            // Nota de rodapé: o caractere da chamada vira um text:note com o texto da nota.
            if let Some(id) = span.marks.iter().find_map(|m| match m {
                Mark::Footnote { id } => Some(id),
                _ => None,
            }) {
                let calls = span
                    .text
                    .chars()
                    .filter(|c| *c == nova_domain_text::FOOTNOTE_CHAR)
                    .count();
                if let Some(n) = notes.iter().position(|(i, _)| i == id) {
                    let text = odf_text(&notes[n].1, true);
                    for _ in 0..calls {
                        body.push_str(&format!(
                            r#"<text:note text:id="ftn{n}" text:note-class="footnote"><text:note-citation>{}</text:note-citation><text:note-body><text:p text:style-name="Footnote">{text}</text:p></text:note-body></text:note>"#,
                            n + 1
                        ));
                    }
                }
                at_start = false;
                continue;
            }
            let text = odf_text(&span.text, at_start);
            at_start = span.text.ends_with(['\u{b}', '\n']);
            let href = span.marks.iter().find_map(|m| match m {
                Mark::Link { href } => Some(href.as_str()),
                _ => None,
            });
            if let Some(href) = href {
                body.push_str(&format!(
                    r#"<text:a xlink:type="simple" xlink:href="{}">"#,
                    esc(href)
                ));
            }
            let props = text_props(&span.marks);
            if props.is_empty() {
                body.push_str(&text);
            } else {
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
            if href.is_some() {
                body.push_str("</text:a>");
            }
        }
        if let Some(entry) = toc.filter(|t| t.level > 0) {
            body.push_str(&format!("<text:tab/>{}", entry.page.max(1)));
        }
        // O comentário continua no parágrafo seguinte se ele começa no mesmo comentário.
        if let Some(id) = open_comment.clone() {
            let continues = paragraphs
                .get(index + 1)
                .and_then(|n| n.spans.first())
                .and_then(comment_of)
                .is_some_and(|next| next == id);
            if !continues {
                close_comment(&mut body, &id);
                open_comment = None;
            }
        }
        body.push_str(close_tag);
        if toc_title {
            body.push_str("</text:index-title>");
        }
        let next_in_toc = paragraphs
            .get(index + 1)
            .is_some_and(|n| n.attrs.toc.is_some() && n.attrs.cell.is_none());
        if toc_open && !next_in_toc {
            body.push_str("</text:index-body></text:table-of-content>");
            toc_open = false;
        }
    }
    close_to(&mut body, &mut open, 0);
    if let Some((table, _, col)) = open_cell {
        body.push_str("</table:table-cell>");
        empty_cells(
            &mut body,
            cols.get(&table)
                .copied()
                .unwrap_or(1)
                .saturating_sub(col + 1),
        );
        body.push_str("</table:table-row></table:table><text:p/>");
    }

    let mut auto = String::new();
    auto.push_str(r#"<style:style style:name="Tab" style:family="table"><style:table-properties style:width="17cm" table:align="margins"/></style:style>"#);
    for (i, shading) in cell_styles.iter().enumerate() {
        let bg = shading
            .as_ref()
            .map(|c| format!(r#" fo:background-color="{}""#, c.to_lowercase()))
            .unwrap_or_default();
        auto.push_str(&format!(
            r#"<style:style style:name="C{i}" style:family="table-cell"><style:table-cell-properties fo:padding="0.097cm" fo:border="0.5pt solid #000000"{bg}/></style:style>"#
        ));
    }
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

/// Modelos do Sumário (níveis 1 a 3): texto, tab com pontilhado e número da página.
const TOC_TEMPLATES: &str = r#"<text:index-title-template text:style-name="Contents_20_Heading">Sumário</text:index-title-template><text:table-of-content-entry-template text:outline-level="1" text:style-name="Contents_20_1"><text:index-entry-link-start/><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/><text:index-entry-link-end/></text:table-of-content-entry-template><text:table-of-content-entry-template text:outline-level="2" text:style-name="Contents_20_2"><text:index-entry-link-start/><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/><text:index-entry-link-end/></text:table-of-content-entry-template><text:table-of-content-entry-template text:outline-level="3" text:style-name="Contents_20_3"><text:index-entry-link-start/><text:index-entry-chapter/><text:index-entry-text/><text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/><text:index-entry-link-end/></text:table-of-content-entry-template>"#;

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

const NS: &str = r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0""#;

const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>"#;

const META: &str = r#"<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"><office:meta><meta:generator>NovaOffice</meta:generator></office:meta></office:document-meta>"#;

/// Estilos comuns com os nomes do LibreOffice ("Heading 1"…, que ele mostra
/// como "Título 1" em português) e os tamanhos do Nova Text.
const STYLES: &str = r##"<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="8pt" fo:line-height="115%"/><style:text-properties fo:font-family="Calibri" fo:font-size="11pt" fo:language="pt" fo:country="BR"/></style:default-style><style:style style:name="Standard" style:family="paragraph" style:class="text"/><style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="12pt" fo:margin-bottom="6pt" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="1" style:class="text"><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="2" style:class="text"><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="3" style:class="text"><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_4" style:display-name="Heading 4" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="4" style:class="text"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_5" style:display-name="Heading 5" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="5" style:class="text"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style><style:style style:name="Heading_20_6" style:display-name="Heading 6" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="6" style:class="text"><style:text-properties fo:font-size="12pt" fo:font-weight="bold"/></style:style><style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm"/><style:text-properties fo:font-style="italic" fo:color="#4a4a46"/></style:style><style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-bottom="0pt" fo:line-height="100%"/><style:text-properties fo:font-family="Consolas" fo:font-size="10pt"/></style:style><style:style style:name="Footnote" style:display-name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-left="0.5cm" fo:margin-bottom="0pt" fo:text-indent="-0.5cm" fo:line-height="100%"/><style:text-properties fo:font-size="10pt"/></style:style></office:styles></office:document-styles>"##;

// ---------------------------------------------------------------- abrir

pub fn import(client: ClientId, bytes: &[u8]) -> Result<TextDocument, AppError> {
    let (paragraphs, media, page, header_footer, watermark, notes, comments) =
        read_document(bytes)?;
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
    if let Some(w) = watermark {
        doc.load_watermark(w)?;
    }
    if !notes.is_empty() {
        doc.load_footnotes(&notes)?;
    }
    if !comments.is_empty() {
        doc.load_comments(&comments)?;
    }
    Ok(doc)
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
    if let Some(b) = attr(e, b"break-before") {
        a.page_break_before = b == "page";
    }
    if let Some(bg) = attr(e, b"background-color") {
        let hex = bg.to_uppercase();
        a.shading = (nova_domain_text::is_hex_color(&hex) && hex != "#FFFFFF").then_some(hex);
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
                // Fundo da célula de tabela: guardado como sombreamento.
                b"paragraph-properties" | b"table-cell-properties" => {
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

/// Nível do Sumário pelo estilo do parágrafo ("Contents 1"…, herdado por estilos automáticos).
fn toc_level_of(name: &str, styles: &HashMap<String, OdfStyle>) -> Option<u8> {
    let mut cur = Some(name.to_string());
    for _ in 0..16 {
        let n = cur?;
        let lower = n.to_lowercase().replace("_20_", " ");
        if lower == "contents heading" {
            return Some(0);
        }
        if let Some(level) = lower
            .strip_prefix("contents ")
            .and_then(|l| l.trim().parse::<u8>().ok())
        {
            return Some(level.clamp(1, nova_domain_text::MAX_TOC_LEVEL));
        }
        cur = styles.get(&n).and_then(|s| s.parent.clone());
    }
    None
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

type Document = (
    Vec<Paragraph>,
    Vec<crate::docx::Media>,
    Option<nova_domain_text::PageSetup>,
    nova_domain_text::HeadersFooters,
    Option<nova_domain_text::Watermark>,
    Vec<(String, String)>,
    Vec<(String, nova_domain_text::Comment)>,
);

/// Nota de rodapé sendo lida: id, texto, profundidade dentro do text:note e
/// profundidade do text:note-citation aberto (0 = fora dele).
struct NoteRead {
    id: String,
    text: String,
    depth: u32,
    citation: u32,
}

fn read_document(bytes: &[u8]) -> Result<Document, AppError> {
    // Imagens do pacote (Pictures/…), lidas antes do texto.
    let mut pictures: HashMap<String, Vec<u8>> = HashMap::new();
    {
        let mut zip = ZipArchive::new(Cursor::new(bytes))
            .map_err(|e| invalid(format!("não é um .odt: {e}")))?;
        for i in 0..zip.len() {
            if let Ok(mut f) = zip.by_index(i) {
                let name = f.name().to_string();
                if name.starts_with("Pictures/") || name.starts_with("media/") {
                    let mut data = Vec::new();
                    if f.read_to_end(&mut data).is_ok() {
                        pictures.insert(name, data);
                    }
                }
            }
        }
    }
    let mut media: Vec<crate::docx::Media> = Vec::new();
    let mut para_images: Vec<nova_domain_text::ImageRef> = Vec::new();
    // draw:frame sendo lido: profundidade, tamanho em pontos e arquivo.
    let mut frame_depth = 0u32;
    let mut frame: (Option<(f64, f64)>, Option<String>) = (None, None);
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
    let mut page = None;
    let mut header_footer = nova_domain_text::HeadersFooters::default();
    let mut watermark = None;
    if let Some(s) = read("styles.xml")? {
        read_styles(&s, &mut styles, &mut lists);
        page = read_page(&s);
        header_footer = read_header_footer(&s, &styles);
        watermark = design::odt_read_watermark(&s);
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
    // Tabelas de primeiro nível: célula atual e o fundo dela.
    let (mut tbl_depth, mut table_no, mut row, mut col) = (0u32, 0u32, 0u16, 0u16);
    let mut cell: Option<nova_domain_text::CellRef> = None;
    let mut cell_shading: Option<String> = None;
    // Sumário (text:table-of-content) e o título dele.
    let (mut in_toc, mut in_toc_title) = (false, false);
    // Nota de rodapé sendo lida (text:note): o texto vai para a nota, não para o parágrafo.
    let mut note: Option<NoteRead> = None;
    // Comentários: o que está sendo lido, os lidos, onde cada trecho começa e termina.
    let mut annotation: Option<crate::comments::AnnotationRead> = None;
    let mut comments: Vec<(String, nova_domain_text::Comment)> = Vec::new();
    let mut comment_starts: HashMap<String, crate::comments::Pos> = HashMap::new();
    let mut comment_ranges: Vec<(String, crate::comments::Pos, crate::comments::Pos)> = Vec::new();
    let mut comment_ids: HashMap<String, String> = HashMap::new();
    let here = |out: &Vec<Paragraph>, para: &Option<Paragraph>| -> crate::comments::Pos {
        let offset = para.as_ref().map_or(0, |p| {
            p.spans
                .iter()
                .map(|s| s.text.encode_utf16().count() as u32)
                .sum()
        });
        (out.len(), offset)
    };
    let mut notes: Vec<(String, String)> = Vec::new();

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
                if let Some(a) = annotation.as_mut() {
                    if !empty {
                        a.depth += 1;
                    }
                    match e.local_name().as_ref() {
                        b"creator" => a.field = b'c',
                        b"date" => a.field = b'd',
                        b"creator-initials" => a.field = b'i',
                        b"p" | b"h" => {
                            if a.has_para {
                                a.text.push('\u{b}');
                            }
                            a.has_para = true;
                            a.field = b'p';
                        }
                        b"line-break" => a.text.push('\u{b}'),
                        b"tab" => a.text.push('\t'),
                        b"s" => a.text.push(' '),
                        _ => {}
                    }
                    buf.clear();
                    continue;
                }
                if in_body && e.local_name().as_ref() == b"annotation-end" {
                    if let Some(name) = attr(e, b"name") {
                        let id = crate::comments::odt_id(&name, &mut comment_ids);
                        if let Some(start) = comment_starts.remove(&id) {
                            comment_ranges.push((id, start, here(&out, &para)));
                        }
                    }
                    buf.clear();
                    continue;
                }
                if in_body && !empty && e.local_name().as_ref() == b"annotation" {
                    let name = attr(e, b"name").unwrap_or_default();
                    let name = if name.is_empty() {
                        format!("anon{}", comments.len() + 1)
                    } else {
                        name
                    };
                    annotation = Some(crate::comments::AnnotationRead {
                        name: crate::comments::odt_id(&name, &mut comment_ids),
                        parent: attr(e, b"parent-name")
                            .map(|p| crate::comments::odt_id(&p, &mut comment_ids)),
                        done: attr(e, b"resolved").is_some_and(|v| v == "true"),
                        depth: 1,
                        start: here(&out, &para),
                        ..Default::default()
                    });
                    buf.clear();
                    continue;
                }
                if let Some(n) = note.as_mut() {
                    if !empty {
                        n.depth += 1;
                    }
                    match e.local_name().as_ref() {
                        b"note-citation" if !empty => n.citation = n.depth,
                        b"p" | b"h" if !n.text.is_empty() => n.text.push('\u{b}'),
                        b"line-break" => n.text.push('\u{b}'),
                        b"tab" => n.text.push('\t'),
                        b"s" => {
                            let c: usize = attr(e, b"c").and_then(|v| v.parse().ok()).unwrap_or(1);
                            n.text.push_str(&" ".repeat(c.min(100)));
                        }
                        _ => {}
                    }
                    buf.clear();
                    continue;
                }
                if frame_depth > 0 {
                    if !empty {
                        frame_depth += 1;
                    }
                    if e.local_name().as_ref() == b"image" && frame.1.is_none() {
                        frame.1 = attr(e, b"href");
                    }
                    buf.clear();
                    continue;
                }
                match e.local_name().as_ref() {
                    b"text" if e.name().as_ref() == b"office:text" => in_body = true,
                    _ if !in_body => {}
                    b"frame" if !empty => {
                        frame_depth = 1;
                        let pt = |k: &[u8]| {
                            attr(e, k)
                                .and_then(|v| length_cm(&v))
                                .map(|cm| cm / 2.54 * 72.0)
                        };
                        frame = (pt(b"width").zip(pt(b"height")), None);
                    }
                    // Nota de rodapé (e de fim, que vira de rodapé): a chamada entra no texto.
                    b"note" if !empty && para.is_some() => {
                        let id = format!("n{}", notes.len() + 1);
                        let mut marks = span_marks.last().cloned().unwrap_or_default();
                        marks.retain(|m| m.kind() != nova_domain_text::MarkKind::Footnote);
                        marks.push(Mark::Footnote { id: id.clone() });
                        push(
                            &mut para,
                            &[marks],
                            &nova_domain_text::FOOTNOTE_CHAR.to_string(),
                        );
                        note = Some(NoteRead {
                            id,
                            text: String::new(),
                            depth: 1,
                            citation: 0,
                        });
                    }
                    b"note"
                    | b"annotation"
                    | b"tracked-changes"
                    | b"sequence-decls"
                    | b"table-of-content-source"
                    | b"alphabetical-index-source"
                    | b"illustration-index-source"
                    | b"table-index-source"
                    | b"object-index-source"
                    | b"user-index-source"
                    | b"bibliography-source"
                        if !empty =>
                    {
                        skip = 1
                    }
                    b"table-of-content" if !empty => in_toc = true,
                    b"index-title" if !empty && in_toc => in_toc_title = true,
                    b"table" if !empty && e.name().as_ref() == b"table:table" => {
                        tbl_depth += 1;
                        if tbl_depth == 1 {
                            table_no += 1;
                            row = u16::MAX;
                        }
                    }
                    b"table-row" if !empty && tbl_depth == 1 => {
                        row = row
                            .wrapping_add(1)
                            .min(nova_domain_text::MAX_TABLE_SIZE - 1);
                        col = u16::MAX;
                    }
                    b"table-cell" | b"covered-table-cell" if tbl_depth == 1 => {
                        col = col
                            .wrapping_add(1)
                            .min(nova_domain_text::MAX_TABLE_SIZE - 1);
                        cell = Some(nova_domain_text::CellRef {
                            table: format!("t{table_no}"),
                            row,
                            col,
                        });
                        cell_shading =
                            attr(e, b"style-name").and_then(|n| resolve(&n, &styles).1.shading);
                        if empty && e.local_name().as_ref() == b"table-cell" {
                            // Célula vazia sem parágrafo: um parágrafo vazio nela.
                            out.push(Paragraph {
                                attrs: ParaAttrs {
                                    cell: cell.clone(),
                                    shading: cell_shading.clone(),
                                    ..ParaAttrs::default()
                                },
                                ..Paragraph::default()
                            });
                        }
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
                        // O título do sumário pode vir fora do índice (o LibreOffice o
                        // grava assim ao abrir um .docx).
                        let toc_style = toc_level_of(&style_name, &styles);
                        let toc_level = match (in_toc, in_toc_title, toc_style) {
                            (true, true, _) | (_, _, Some(0)) => Some(0),
                            (true, false, level) => Some(level.unwrap_or(1)),
                            _ => None,
                        };
                        if let Some(level) = toc_level.filter(|_| cell.is_none()) {
                            if level > 0 {
                                style = BlockStyle::Paragraph;
                            }
                            attrs.toc = Some(nova_domain_text::TocEntry { level, page: 0 });
                        }
                        para = Some(Paragraph {
                            style,
                            attrs,
                            spans: Vec::new(),
                        });
                        span_marks = vec![marks];
                        if let (Some(p), Some(c)) = (para.as_mut(), &cell) {
                            p.attrs.cell = Some(c.clone());
                            if cell_shading.is_some() {
                                p.attrs.shading = cell_shading.clone();
                            }
                        }
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
                    b"a" if !empty => {
                        let mut marks = span_marks.last().cloned().unwrap_or_default();
                        if let Some(href) =
                            attr(e, b"href").filter(|h| nova_domain_text::is_link(h))
                        {
                            marks.retain(|m| m.kind() != nova_domain_text::MarkKind::Link);
                            marks.push(Mark::Link { href });
                        }
                        span_marks.push(marks);
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
            Event::Text(t) if annotation.is_some() => {
                let raw = t.unescape().map_err(|e| invalid(format!("XML: {e}")))?;
                let a = annotation.as_mut().expect("comentário aberto");
                match a.field {
                    b'c' => a.author.push_str(&raw),
                    b'd' => a.date.push_str(&raw),
                    b'i' => a.initials.push_str(&raw),
                    b'p' => a.text.push_str(&raw),
                    _ => {}
                }
            }
            Event::End(_) if annotation.is_some() => {
                let a = annotation.as_mut().expect("comentário aberto");
                a.depth -= 1;
                a.field = if a.depth > 1 && a.field == b'p' {
                    b'p'
                } else {
                    0
                };
                if a.depth == 0 {
                    let a = annotation.take().expect("comentário aberto");
                    let start = a.start;
                    let (id, c) = a.into_comment();
                    if c.parent.is_none() {
                        comment_starts.insert(id.clone(), start);
                    }
                    comments.push((id, c));
                }
            }
            Event::Text(t) if note.as_ref().is_some_and(|n| n.citation == 0) => {
                let raw = t.unescape().map_err(|e| invalid(format!("XML: {e}")))?;
                let n = note.as_mut().expect("nota aberta");
                let mut last_space = n.text.ends_with(' ');
                for ch in raw.chars() {
                    if ch.is_whitespace() {
                        if !last_space {
                            n.text.push(' ');
                        }
                        last_space = true;
                    } else {
                        n.text.push(ch);
                        last_space = false;
                    }
                }
            }
            // Texto da citação (o número da nota): a tela numera sozinha.
            Event::Text(_) if note.is_some() => {}
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
            Event::End(_) if note.is_some() => {
                let n = note.as_mut().expect("nota aberta");
                if n.citation == n.depth {
                    n.citation = 0;
                }
                n.depth -= 1;
                if n.depth == 0 {
                    let n = note.take().expect("nota aberta");
                    let text: String = n
                        .text
                        .trim_matches(|c: char| c == ' ' || c == '\u{b}')
                        .chars()
                        .take(nova_domain_text::MAX_NOTE_CHARS)
                        .collect();
                    notes.push((n.id, text));
                }
            }
            Event::End(e) => {
                if skip > 0 {
                    skip -= 1;
                    buf.clear();
                    continue;
                }
                if frame_depth > 0 {
                    frame_depth -= 1;
                    if frame_depth == 0 {
                        let data = frame
                            .1
                            .take()
                            .and_then(|href| pictures.get(href.trim_start_matches("./")));
                        if let Some(data) = data.filter(|d| crate::media::sniff_mime(d).is_some()) {
                            let id = crate::media::media_id(data);
                            let (width, height) = match frame.0.take() {
                                Some((w, h)) => crate::media::fit(
                                    w,
                                    h,
                                    f64::from(nova_domain_text::MAX_IMAGE_PT),
                                ),
                                None => crate::media::initial_size(data),
                            };
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
                    b"text" if e.name().as_ref() == b"office:text" => in_body = false,
                    b"list" => {
                        list_stack.pop();
                    }
                    b"span" | b"a" => {
                        if span_marks.len() > 1 {
                            span_marks.pop();
                        }
                    }
                    b"table" if e.name().as_ref() == b"table:table" => {
                        tbl_depth = tbl_depth.saturating_sub(1);
                        if tbl_depth == 0 {
                            cell = None;
                        }
                    }
                    b"table-of-content" => in_toc = false,
                    b"index-title" => in_toc_title = false,
                    b"p" | b"h" => {
                        if let Some(mut p) = para.take() {
                            if let Some(mut entry) = p.attrs.toc.filter(|t| t.level > 0) {
                                entry.page = crate::docx::take_toc_page(&mut p);
                                p.attrs.toc = Some(entry);
                            }
                            // Imagens do parágrafo: cada uma num parágrafo próprio, antes do texto.
                            let images = std::mem::take(&mut para_images);
                            let text_too = p.spans.iter().any(|s| !s.text.trim().is_empty());
                            let count = images.len();
                            for (i, image) in images.into_iter().enumerate() {
                                if i + 1 == count && !text_too {
                                    p.spans.clear();
                                    p.attrs.image = Some(image);
                                    p.attrs.list = None;
                                } else {
                                    out.push(Paragraph {
                                        attrs: ParaAttrs {
                                            image: Some(image),
                                            list: None,
                                            ..p.attrs.clone()
                                        },
                                        ..Paragraph::default()
                                    });
                                }
                            }
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
    // Comentários sem office:annotation-end (sem seleção): marcam um caractere.
    for (id, start) in comment_starts {
        comment_ranges.push((id, start, start));
    }
    crate::comments::apply_ranges(&mut out, &comment_ranges);
    comments.retain(|(id, c)| c.validate(id).is_ok());
    crate::docx::normalize(&mut out);
    Ok((out, media, page, header_footer, watermark, notes, comments))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::{ParaAttr, TextCommand};

    /// O LibreOffice grava um `style:default-page-layout` sem tamanho antes do
    /// layout da página, e o cabeçalho fica dentro da margem de cima.
    #[test]
    fn pagina_do_libreoffice() {
        let xml = r##"<office:document-styles><office:styles><style:default-page-layout><style:page-layout-properties style:layout-grid-standard-mode="true"/></style:default-page-layout></office:styles><office:automatic-styles><style:page-layout style:name="Mpm1"><style:page-layout-properties fo:page-width="21.001cm" fo:page-height="29.7cm" fo:margin-top="0.847cm" fo:margin-bottom="0.847cm" fo:margin-left="0.847cm" fo:margin-right="0.847cm" fo:border="1.5pt solid #2f5496" fo:padding-top="0.349cm" fo:padding-bottom="1.6cm" fo:padding-left="1.6cm" fo:padding-right="1.6cm" style:shadow="#000000 0.053cm 0.053cm" fo:background-color="#fff2cc" draw:fill="solid" draw:fill-color="#fff2cc"/><style:header-style><style:header-footer-properties fo:min-height="1.251cm" fo:margin-bottom="1.15cm"/></style:header-style><style:footer-style/></style:page-layout></office:automatic-styles></office:document-styles>"##;
        let page = read_page(xml).unwrap();
        let d = nova_domain_text::PageSetup::default();
        assert_eq!((page.width, page.height), (d.width, d.height));
        // 2,5 cm de margem: 0,847 cm + borda de 1,5 pt + enchimento (+ cabeçalho em cima).
        for m in [
            page.margin_top,
            page.margin_bottom,
            page.margin_left,
            page.margin_right,
        ] {
            assert!(m.abs_diff(1417) <= 1, "{page:?}");
        }
        assert_eq!(page.background.as_deref(), Some("#FFF2CC"));
        let border = page.border.unwrap();
        assert_eq!(
            (border.style, border.color.as_str(), border.width),
            (nova_domain_text::BorderStyle::Shadow, "#2F5496", 12)
        );
    }

    /// Com cabeçalho e rodapé, a margem do estilo de página vai até eles (como o
    /// LibreOffice grava um .docx) e o texto começa na margem do Nova: antes o
    /// LibreOffice punha o cabeçalho dentro da margem e descia o texto.
    #[test]
    fn cabecalho_dentro_da_margem() {
        let page = nova_domain_text::PageSetup::default();
        let line = nova_domain_text::HeaderFooter {
            text: "Relatório {PAGE}".into(),
            ..Default::default()
        };
        let hf = nova_domain_text::HeadersFooters {
            header: line.clone(),
            footer: line,
            ..Default::default()
        };
        let xml = styles_xml(&page, &hf, None);
        assert!(xml.contains(r#"fo:margin-top="1.249cm" fo:margin-bottom="1.249cm""#));
        assert!(xml.contains(r#"<style:header-style><style:header-footer-properties fo:min-height="1.251cm" fo:margin-bottom="1.150cm" style:dynamic-spacing="true"/>"#));
        assert!(xml.contains(r#"<style:footer-style><style:header-footer-properties fo:min-height="1.251cm" fo:margin-top="1.150cm" style:dynamic-spacing="true"/>"#));
        let back = read_page(&xml).unwrap();
        assert_eq!(
            (back.margin_top, back.margin_bottom),
            (page.margin_top, page.margin_bottom)
        );
        // Sem cabeçalho nem rodapé, a margem é a do Nova.
        let xml = styles_xml(&page, &Default::default(), None);
        assert!(xml.contains(r#"fo:margin-top="2.499cm" fo:margin-bottom="2.499cm""#));
    }

    fn sample() -> TextDocument {
        let mut doc = TextDocument::from_plain_text(
            1,
            "Relatório\n  dois  espaços e negrito\nitem\nsub\npasso\nmeio\nnovo\nRua A\u{b}São Paulo\tSP",
        );
        let cmds = vec![
            TextCommand::ApplyMark {
                block: 7,
                offset: 0,
                len: 5,
                mark: Mark::Link {
                    href: "https://exemplo.com/a?b=1&c=2".into(),
                },
            },
            TextCommand::SetBlockAttr {
                block: 7,
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
                block: 5,
                attr: ParaAttr::Shading(Some("#343541".into())),
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

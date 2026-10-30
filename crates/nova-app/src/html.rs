//! Página da Web (.html): exportar o documento com a formatação em CSS.

use nova_domain_text::{Align, BlockStyle, ListKind, Mark, Paragraph, TextDocument};

const HIGHLIGHT: [(&str, &str); 15] = [
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

fn esc(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn span_html(text: &str, marks: &[Mark]) -> String {
    let mut html = esc(text).replace('\u{b}', "<br>");
    let mut css = Vec::new();
    for m in marks {
        match m {
            Mark::Bold => html = format!("<strong>{html}</strong>"),
            Mark::Italic => html = format!("<em>{html}</em>"),
            Mark::Underline => html = format!("<u>{html}</u>"),
            Mark::Strike => html = format!("<s>{html}</s>"),
            Mark::VertAlign { value } if value == "superscript" => {
                html = format!("<sup>{html}</sup>")
            }
            Mark::VertAlign { .. } => html = format!("<sub>{html}</sub>"),
            Mark::FontFamily { value } => {
                css.push(format!("font-family:'{}'", esc(value).replace('\'', "")))
            }
            Mark::FontSize { half_points } => {
                css.push(format!("font-size:{}pt", f64::from(*half_points) / 2.0))
            }
            Mark::Color { value } => css.push(format!("color:{value}")),
            Mark::Link { .. }
            | Mark::Footnote { .. }
            | Mark::Comment { .. }
            | Mark::Citation { .. } => {}
            Mark::Highlight { value } => {
                let hex = HIGHLIGHT
                    .iter()
                    .find(|(n, _)| n == value)
                    .map_or("#ffff00", |(_, h)| h);
                css.push(format!("background:{hex}"));
            }
        }
    }
    let html = if css.is_empty() {
        html
    } else {
        format!(r#"<span style="{}">{html}</span>"#, css.join(";"))
    };
    match marks.iter().find_map(|m| match m {
        Mark::Link { href } => Some(href),
        _ => None,
    }) {
        Some(href) => format!(r#"<a href="{}">{html}</a>"#, esc(href)),
        None => html,
    }
}

fn paragraph_html(p: &Paragraph, tag: &str, image: Option<&str>) -> String {
    let mut css = Vec::new();
    match p.attrs.align {
        Align::Left => {}
        Align::Center => css.push("text-align:center".to_string()),
        Align::Right => css.push("text-align:right".to_string()),
        Align::Justify => css.push("text-align:justify".to_string()),
    }
    if p.attrs.list.is_none() && p.attrs.indent > 0 {
        css.push(format!(
            "margin-left:{:.2}cm",
            f64::from(p.attrs.indent) * 1.27
        ));
    }
    if let Some(v) = p.attrs.line_spacing {
        css.push(format!("line-height:{:.2}", f64::from(v) / 100.0 * 1.15));
    }
    if let Some(v) = p.attrs.space_before {
        css.push(format!("margin-top:{v}pt"));
    }
    if let Some(v) = p.attrs.space_after {
        css.push(format!("margin-bottom:{v}pt"));
    }
    if p.attrs.page_break_before {
        css.push("break-before:page".to_string());
    }
    if let Some(bg) = p.attrs.shading.as_ref().filter(|_| p.attrs.cell.is_none()) {
        css.push(format!("background:{bg};padding:2pt 4pt"));
        // Cor "automática" do Word: texto claro sobre fundo escuro.
        if crate::is_dark(bg) {
            css.push("color:#fff".to_string());
        }
    }
    let style = if css.is_empty() {
        String::new()
    } else {
        format!(r#" style="{}""#, css.join(";"))
    };
    let mut inner: String = image.unwrap_or_default().to_string();
    inner.extend(p.spans.iter().map(|s| span_html(&s.text, &s.marks)));
    let inner = if inner.is_empty() {
        "<br>".to_string()
    } else {
        inner
    };
    format!("<{tag}{style}>{inner}</{tag}>")
}

pub fn export(doc: &TextDocument, title: &str) -> String {
    let mut body = String::new();
    // Listas abertas, do nível 0 para dentro.
    let mut open: Vec<&str> = Vec::new();
    // Célula aberta: (tabela, linha, coluna).
    let mut cell: Option<(String, u16, u16)> = None;
    for p in doc.paragraphs() {
        let key = p
            .attrs
            .cell
            .as_ref()
            .map(|c| (c.table.clone(), c.row, c.col));
        if key != cell {
            while let Some(t) = open.pop() {
                body.push_str(&format!("</{t}>"));
            }
            match (&cell, &key) {
                (Some((t, r, _)), Some((t2, r2, _))) if t == t2 => {
                    body.push_str(if r == r2 { "</td>" } else { "</td></tr><tr>" })
                }
                (Some(_), _) => body.push_str("</td></tr></table>\n"),
                _ => {}
            }
            if let Some((t, ..)) = &key {
                if !matches!(&cell, Some((t0, ..)) if t0 == t) {
                    body.push_str(r#"<table style="border-collapse:collapse;width:100%"><tr>"#);
                }
                let bg = p
                    .attrs
                    .shading
                    .as_ref()
                    .map(|c| format!(";background:{c}"))
                    .unwrap_or_default();
                body.push_str(&format!(
                    r#"<td style="border:1px solid #000;padding:2pt 5pt;vertical-align:top{bg}">"#
                ));
            }
            cell = key;
        }
        // Imagem embutida no próprio HTML (data URL): o arquivo abre sozinho.
        let img = p.attrs.image.as_ref().and_then(|i| {
            let (mime, data) = doc.media(&i.id)?;
            Some(format!(
                r#"<img src="{}" style="width:{}pt;height:{}pt" alt="">"#,
                crate::media::data_url(&mime, &data),
                i.width,
                i.height
            ))
        });
        match p.attrs.list {
            Some(kind) => {
                let tag = if kind == ListKind::Bullet { "ul" } else { "ol" };
                let level = usize::from(p.attrs.indent);
                while open.len() > level + 1 || (open.len() == level + 1 && open[level] != tag) {
                    body.push_str(&format!("</{}>", open.pop().unwrap_or("ul")));
                }
                while open.len() < level + 1 {
                    body.push_str(&format!("<{tag}>"));
                    open.push(tag);
                }
                body.push_str(&paragraph_html(&p, "li", img.as_deref()));
            }
            None => {
                while let Some(t) = open.pop() {
                    body.push_str(&format!("</{t}>"));
                }
                let tag = match p.style {
                    BlockStyle::Paragraph => "p",
                    BlockStyle::Heading1 => "h1",
                    BlockStyle::Heading2 => "h2",
                    BlockStyle::Heading3 => "h3",
                    BlockStyle::Heading4 => "h4",
                    BlockStyle::Heading5 => "h5",
                    BlockStyle::Heading6 => "h6",
                    BlockStyle::Quote => "blockquote",
                    BlockStyle::Code => "pre",
                };
                body.push_str(&paragraph_html(&p, tag, img.as_deref()));
            }
        }
        body.push('\n');
    }
    while let Some(t) = open.pop() {
        body.push_str(&format!("</{t}>"));
    }
    if cell.is_some() {
        body.push_str("</td></tr></table>");
    }
    let body = crate::citations::replace(&body, &crate::citations::texts(doc), esc);
    let notes = crate::notes::collect(doc);
    let mut body = crate::notes::replace_calls(&body, &notes, |n| {
        format!(r##"<sup><a href="#nota-{n}" id="chamada-{n}">{n}</a></sup>"##)
    });
    if !notes.texts.is_empty() {
        body.push_str("<hr>\n<ol class=\"notas\">\n");
        for (i, t) in notes.texts.iter().enumerate() {
            let n = i + 1;
            body.push_str(&format!(
                r##"<li id="nota-{n}">{} <a href="#chamada-{n}">↩</a></li>"##,
                esc(t).replace('\u{b}', "<br>")
            ));
            body.push('\n');
        }
        body.push_str("</ol>\n");
    }
    format!(
        "<!DOCTYPE html>\n<html lang=\"pt-BR\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"generator\" content=\"NovaOffice\">\n<title>{}</title>\n<style>body{{max-width:210mm;margin:2.5cm auto;font-family:Calibri,Carlito,'Segoe UI',sans-serif;font-size:11pt;line-height:1.5}}blockquote{{border-left:3px solid #ccc;margin-left:0;padding-left:12pt;color:#4a4a46}}pre{{background:#f4f4f1;padding:4pt 8pt;font-family:Consolas,monospace;font-size:10pt}}</style>\n</head>\n<body>\n{body}</body>\n</html>\n",
        esc(title)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::{ParaAttr, TextCommand};

    #[test]
    fn pagina_com_listas_e_marcas() {
        let mut doc = TextDocument::from_plain_text(1, "Título\na <b>\nitem\nsub\nfim");
        for c in [
            TextCommand::SetBlockStyle {
                block: 0,
                style: BlockStyle::Heading1,
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 0,
                len: 1,
                mark: Mark::Bold,
            },
            TextCommand::SetBlockAttr {
                block: 1,
                attr: ParaAttr::Align(Align::Center),
            },
            TextCommand::SetBlockAttr {
                block: 2,
                attr: ParaAttr::List(Some(ListKind::Bullet)),
            },
            TextCommand::SetBlockAttr {
                block: 3,
                attr: ParaAttr::List(Some(ListKind::Number)),
            },
            TextCommand::SetBlockAttr {
                block: 3,
                attr: ParaAttr::Indent(1),
            },
        ] {
            doc.execute(c).unwrap();
        }
        let html = export(&doc, "Relatório & cia");
        assert!(html.contains("<title>Relatório &amp; cia</title>"));
        assert!(html.contains(r#"<p style="text-align:center"><strong>a</strong> &lt;b&gt;</p>"#));
        assert!(html.contains("<ul><li>item</li>\n<ol><li>sub</li>\n</ol></ul><p>fim</p>"));
    }
}

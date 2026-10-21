//! Exportação para Markdown (CommonMark, com `~~tachado~~` do GFM).
//!
//! Fonte, tamanho e cor não têm equivalente em Markdown e são descartados.

use nova_domain_text::{BlockStyle, MarkKind, Span, TextDocument};

pub fn export(doc: &TextDocument) -> String {
    (0..doc.block_count())
        .map(|i| block(doc, i))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn block(doc: &TextDocument, index: u32) -> String {
    let style = doc.block_style(index).expect("índice dentro do documento");
    if style == BlockStyle::Code {
        let text = doc.block_text(index).expect("índice dentro do documento");
        return format!("    {text}");
    }
    let body: String = doc
        .block_spans(index)
        .expect("índice dentro do documento")
        .iter()
        .map(inline)
        .collect();
    match style.heading_level() {
        Some(level) => format!("{} {body}", "#".repeat(level as usize)),
        None if style == BlockStyle::Quote => format!("> {body}"),
        None => body,
    }
}

/// Marcadores ficam colados ao texto: `**dois** ` e não `**dois **`, que o
/// CommonMark não reconhece como ênfase.
fn inline(span: &Span) -> String {
    let text = escape(&span.text);
    let core = text.trim();
    if core.is_empty() {
        return text;
    }
    let leading = &text[..text.len() - text.trim_start().len()];
    let trailing = &text[text.trim_end().len()..];

    let mut out = core.to_string();
    if span.has(MarkKind::Underline) {
        out = format!("<u>{out}</u>");
    }
    if span.has(MarkKind::Strike) {
        out = format!("~~{out}~~");
    }
    if span.has(MarkKind::Italic) {
        out = format!("*{out}*");
    }
    if span.has(MarkKind::Bold) {
        out = format!("**{out}**");
    }
    format!("{leading}{out}{trailing}")
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if "\\`*_~[]<>#".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::{Mark, TextCommand};

    #[test]
    fn titulos_marcas_citacao_e_codigo() {
        let mut doc =
            TextDocument::from_plain_text(1, "Relatório\num dois tres\nfrase\nlet x = 1;");
        for command in [
            TextCommand::SetBlockStyle {
                block: 0,
                style: BlockStyle::Heading1,
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 3,
                len: 5,
                mark: Mark::Bold,
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 8,
                len: 4,
                mark: Mark::Italic,
            },
            TextCommand::SetBlockStyle {
                block: 2,
                style: BlockStyle::Quote,
            },
            TextCommand::SetBlockStyle {
                block: 3,
                style: BlockStyle::Code,
            },
        ] {
            doc.execute(command).unwrap();
        }
        assert_eq!(
            export(&doc),
            "# Relatório\n\num **dois** *tres*\n\n> frase\n\n    let x = 1;"
        );
    }

    #[test]
    fn escapa_caracteres_do_markdown() {
        let doc = TextDocument::from_plain_text(1, "2*3 = 6 #fato");
        assert_eq!(export(&doc), r"2\*3 = 6 \#fato");
    }
}

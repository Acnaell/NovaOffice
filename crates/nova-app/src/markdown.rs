//! Exportação para Markdown (CommonMark, com `~~tachado~~` do GFM).
//!
//! Fonte, tamanho e cor não têm equivalente em Markdown e são descartados.

use nova_domain_text::{BlockStyle, ListKind, MarkKind, Span, TextDocument};

pub fn export(doc: &TextDocument) -> String {
    let mut out = String::new();
    // Contador de cada nível de lista numerada; zera quando a lista acaba.
    let mut counters = [0u32; 9];
    let mut previous_was_list = false;
    for i in 0..doc.block_count() {
        let attrs = doc.block_attrs(i).expect("índice dentro do documento");
        let text = block(doc, i);
        let line = match attrs.list {
            Some(kind) => {
                let level = attrs.indent as usize;
                counters[level + 1..].iter_mut().for_each(|c| *c = 0);
                let marker = match kind {
                    ListKind::Bullet => "-".to_string(),
                    ListKind::Number => {
                        counters[level] += 1;
                        format!("{}.", counters[level])
                    }
                };
                format!("{}{marker} {text}", "    ".repeat(level))
            }
            None => {
                counters = [0; 9];
                text
            }
        };
        if i > 0 {
            // Itens seguidos da mesma lista ficam em linhas vizinhas.
            out.push_str(if previous_was_list && attrs.list.is_some() {
                "\n"
            } else {
                "\n\n"
            });
        }
        previous_was_list = attrs.list.is_some();
        out.push_str(&line);
    }
    out
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
    fn listas_com_marcadores_numeradas_e_niveis() {
        use nova_domain_text::ParaAttr;
        let mut doc = TextDocument::from_plain_text(
            1,
            "Compras\npão\nleite\nintegral\nPassos\nabrir\nfechar",
        );
        let set = |doc: &mut TextDocument, block, attr| {
            doc.execute(TextCommand::SetBlockAttr { block, attr })
                .unwrap();
        };
        for b in 1..=3 {
            set(&mut doc, b, ParaAttr::List(Some(ListKind::Bullet)));
        }
        set(&mut doc, 3, ParaAttr::Indent(1));
        for b in 5..=6 {
            set(&mut doc, b, ParaAttr::List(Some(ListKind::Number)));
        }
        assert_eq!(
            export(&doc),
            "Compras\n\n- pão\n- leite\n    - integral\n\nPassos\n\n1. abrir\n2. fechar"
        );
    }

    #[test]
    fn escapa_caracteres_do_markdown() {
        let doc = TextDocument::from_plain_text(1, "2*3 = 6 #fato");
        assert_eq!(export(&doc), r"2\*3 = 6 \#fato");
    }
}

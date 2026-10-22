//! Markdown (CommonMark, com `~~tachado~~` do GFM): exportar e abrir.
//!
//! Fonte, tamanho e cor não têm equivalente em Markdown e são descartados.

use nova_crdt::ClientId;
use nova_domain_text::{
    BlockStyle, ListKind, Mark, MarkKind, ParaAttrs, Paragraph, Span, TextDocument, MAX_INDENT,
};

use crate::AppError;

pub fn export(doc: &TextDocument) -> String {
    let mut out = String::new();
    // Contador de cada nível de lista numerada; zera quando a lista acaba.
    let mut counters = [0u32; 9];
    let mut previous_was_list = false;
    let mut i = 0;
    while i < doc.block_count() {
        let attrs = doc.block_attrs(i).expect("índice dentro do documento");
        // Tabela: todos os parágrafos dela viram uma tabela do GitHub (| a | b |).
        if let Some(cell) = &attrs.cell {
            let start = i;
            let mut grid: Vec<Vec<String>> = Vec::new();
            while i < doc.block_count() {
                let Some(c) = doc.block_attrs(i).expect("índice").cell else {
                    break;
                };
                if c.table != cell.table {
                    break;
                }
                let (r, k) = (usize::from(c.row), usize::from(c.col));
                if grid.len() <= r {
                    grid.resize(r + 1, Vec::new());
                }
                if grid[r].len() <= k {
                    grid[r].resize(k + 1, String::new());
                }
                let text = block(doc, i).trim().replace('|', "\\|");
                let slot = &mut grid[r][k];
                if !slot.is_empty() {
                    slot.push_str("<br>");
                }
                slot.push_str(&text);
                i += 1;
            }
            let cols = grid.iter().map(Vec::len).max().unwrap_or(1).max(1);
            let row = |cells: &[String]| {
                let mut line = String::from("|");
                for k in 0..cols {
                    line.push_str(&format!(" {} |", cells.get(k).map_or("", String::as_str)));
                }
                line
            };
            let mut table = vec![row(&grid[0])];
            table.push(format!("|{}", " --- |".repeat(cols)));
            table.extend(grid[1..].iter().map(|r| row(r)));
            if start > 0 {
                out.push_str("\n\n");
            }
            out.push_str(&table.join("\n"));
            previous_was_list = false;
            counters = [0; 9];
            continue;
        }
        let text = match &attrs.image {
            // Imagem embutida no próprio Markdown (data URL), para o arquivo abrir sozinho.
            Some(image) => match doc.media(&image.id) {
                Some((mime, data)) => format!("![]({})", crate::media::data_url(&mime, &data)),
                None => String::new(),
            },
            None => block(doc, i),
        };
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
        i += 1;
    }
    out
}

fn block(doc: &TextDocument, index: u32) -> String {
    let style = doc.block_style(index).expect("índice dentro do documento");
    if style == BlockStyle::Code {
        let text = doc.block_text(index).expect("índice dentro do documento");
        return format!("    {text}");
    }
    let spans = doc.block_spans(index).expect("índice dentro do documento");
    // Trechos vizinhos com o mesmo link viram um só [texto](endereço).
    let mut body = String::new();
    let mut i = 0;
    while i < spans.len() {
        let href = link_of(&spans[i]);
        let mut j = i + 1;
        while j < spans.len() && href.is_some() && link_of(&spans[j]) == href {
            j += 1;
        }
        let text: String = spans[i..j].iter().map(inline).collect();
        match href {
            Some(h) => body.push_str(&format!(
                "[{text}]({})",
                h.replace(' ', "%20").replace(')', "%29")
            )),
            None => body.push_str(&text),
        }
        i = j;
    }
    match style.heading_level() {
        Some(level) => format!("{} {body}", "#".repeat(level as usize)),
        None if style == BlockStyle::Quote => format!("> {body}"),
        None => body,
    }
}

fn link_of(span: &Span) -> Option<&str> {
    span.marks.iter().find_map(|m| match m {
        Mark::Link { href } => Some(href.as_str()),
        _ => None,
    })
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
        // Quebra de linha manual (Shift+Enter): quebra forçada do CommonMark.
        if ch == '\u{b}' {
            out.push_str("\\\n");
            continue;
        }
        if "\\`*_~[]<>#".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

// ---------------------------------------------------------------- abrir

/// Abre Markdown: títulos, citações, código, listas aninhadas, ênfase,
/// tachado, `<u>`, links (fica o texto) e quebras forçadas.
pub fn import(client: ClientId, text: &str) -> Result<TextDocument, AppError> {
    let paragraphs = parse(text);
    // Imagens em data URL (![](data:image/png;base64,…)) viram imagens embutidas.
    let mut images: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut paragraphs: Vec<Paragraph> = paragraphs
        .into_iter()
        .enumerate()
        .map(|(i, mut p)| {
            let raw = p.text();
            let line = raw.trim();
            if let Some(url) = line
                .strip_prefix("![")
                .and_then(|rest| rest.split_once("]("))
                .and_then(|(_, rest)| rest.strip_suffix(')'))
            {
                if let Some(data) = crate::media::from_data_url(url) {
                    images.push((i, data));
                    p.spans.clear();
                }
            }
            p
        })
        .collect();
    let doc = TextDocument::new(client);
    for (i, data) in &images {
        if let Some(image) = crate::media::embed(&doc, data, None) {
            paragraphs[*i].attrs.image = Some(image);
        }
    }
    let built = TextDocument::from_paragraphs(client, &paragraphs)?;
    for id in paragraphs
        .iter()
        .filter_map(|p| p.attrs.image.as_ref().map(|i| i.id.clone()))
    {
        if let Some((mime, data)) = doc.media(&id) {
            built.put_media(&id, &mime, &data)?;
        }
    }
    Ok(built)
}

fn parse(text: &str) -> Vec<Paragraph> {
    let mut out: Vec<Paragraph> = Vec::new();
    // Parágrafo de texto em montagem (linhas seguidas se juntam).
    let mut pending: Option<(BlockStyle, ParaAttrs, String)> = None;
    let mut list_indents: Vec<usize> = Vec::new();
    let mut fence: Option<String> = None;

    let flush = |out: &mut Vec<Paragraph>,
                 pending: &mut Option<(BlockStyle, ParaAttrs, String)>| {
        if let Some((style, attrs, raw)) = pending.take() {
            out.push(Paragraph {
                style,
                attrs,
                spans: parse_inline(&raw),
            });
        }
    };

    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut tables = 0;
    let mut next = 0;
    while next < lines.len() {
        let line = lines[next];
        next += 1;
        if let Some(marker) = &fence {
            if line.trim_start().starts_with(marker.as_str()) {
                fence = None;
            } else {
                out.push(code_paragraph(line));
            }
            continue;
        }
        let trimmed = line.trim_start();
        let spaces = line.len() - trimmed.len();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            flush(&mut out, &mut pending);
            fence = Some(trimmed[..3].to_string());
            continue;
        }
        if trimmed.is_empty() {
            flush(&mut out, &mut pending);
            continue;
        }
        // Imagem embutida numa linha só: fica crua até import() embutir o arquivo.
        if trimmed.starts_with("![") && trimmed.contains("](data:") && trimmed.ends_with(')') {
            flush(&mut out, &mut pending);
            out.push(Paragraph {
                spans: vec![Span {
                    text: trimmed.to_string(),
                    marks: Vec::new(),
                }],
                ..Paragraph::default()
            });
            continue;
        }
        // Tabela do GitHub: linha com | seguida de | --- | --- |.
        if trimmed.starts_with('|') && lines.get(next).is_some_and(|l| is_table_rule(l)) {
            flush(&mut out, &mut pending);
            list_indents.clear();
            tables += 1;
            let mut rows = vec![trimmed];
            next += 1;
            while let Some(l) = lines
                .get(next)
                .map(|l| l.trim())
                .filter(|l| l.starts_with('|'))
            {
                rows.push(l);
                next += 1;
            }
            for (r, row) in rows.iter().enumerate() {
                for (c, cell) in table_cells(row).iter().enumerate() {
                    let cell_ref = nova_domain_text::CellRef {
                        table: format!("t{tables}"),
                        row: (r as u16).min(nova_domain_text::MAX_TABLE_SIZE - 1),
                        col: (c as u16).min(nova_domain_text::MAX_TABLE_SIZE - 1),
                    };
                    // "<br>" separa parágrafos dentro da célula.
                    for part in cell.split("<br>") {
                        out.push(Paragraph {
                            style: BlockStyle::Paragraph,
                            attrs: ParaAttrs {
                                cell: Some(cell_ref.clone()),
                                ..ParaAttrs::default()
                            },
                            spans: parse_inline(part.trim()),
                        });
                    }
                }
            }
            continue;
        }
        // Código indentado (fora de listas).
        if spaces >= 4 && list_indents.is_empty() && pending.is_none() {
            out.push(code_paragraph(&line[4.min(line.len())..]));
            continue;
        }
        if let Some((level, rest)) = heading(trimmed) {
            flush(&mut out, &mut pending);
            list_indents.clear();
            let style = [
                BlockStyle::Heading1,
                BlockStyle::Heading2,
                BlockStyle::Heading3,
                BlockStyle::Heading4,
                BlockStyle::Heading5,
                BlockStyle::Heading6,
            ][level - 1];
            out.push(Paragraph {
                style,
                attrs: ParaAttrs::default(),
                spans: parse_inline(rest),
            });
            continue;
        }
        if is_rule(trimmed) {
            flush(&mut out, &mut pending);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('>') {
            flush(&mut out, &mut pending);
            list_indents.clear();
            let rest = rest.strip_prefix(' ').unwrap_or(rest);
            pending = Some((BlockStyle::Quote, ParaAttrs::default(), rest.to_string()));
            continue;
        }
        if let Some((kind, rest)) = list_item(trimmed) {
            flush(&mut out, &mut pending);
            while list_indents.last().is_some_and(|&i| spaces < i) {
                list_indents.pop();
            }
            if !list_indents.last().is_some_and(|&i| spaces <= i) {
                list_indents.push(spaces);
            }
            let attrs = ParaAttrs {
                list: Some(kind),
                indent: ((list_indents.len() - 1) as u8).min(MAX_INDENT),
                ..ParaAttrs::default()
            };
            pending = Some((BlockStyle::Paragraph, attrs, rest.to_string()));
            continue;
        }
        // Continuação do parágrafo (ou do item) anterior.
        match pending.as_mut() {
            Some((_, _, raw)) => {
                // Dois espaços ou "\" no fim: quebra forçada.
                if raw.ends_with("  ") || raw.ends_with('\\') {
                    let keep = raw.trim_end_matches(' ').trim_end_matches('\\').len();
                    raw.truncate(keep);
                    raw.push('\u{b}');
                } else {
                    raw.push(' ');
                }
                raw.push_str(trimmed);
            }
            None => {
                list_indents.clear();
                pending = Some((
                    BlockStyle::Paragraph,
                    ParaAttrs::default(),
                    trimmed.to_string(),
                ));
            }
        }
    }
    flush(&mut out, &mut pending);
    if out.is_empty() {
        out.push(Paragraph::default());
    }
    crate::docx::normalize(&mut out);
    out
}

fn code_paragraph(line: &str) -> Paragraph {
    Paragraph {
        style: BlockStyle::Code,
        attrs: ParaAttrs::default(),
        spans: vec![Span {
            text: line.to_string(),
            marks: vec![],
        }],
    }
}

fn heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let rest = &line[hashes..];
    if !(rest.is_empty() || rest.starts_with(' ')) {
        return None;
    }
    Some((hashes, rest.trim().trim_end_matches('#').trim_end()))
}

fn is_rule(line: &str) -> bool {
    let l: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    l.len() >= 3
        && (l.chars().all(|c| c == '-')
            || l.chars().all(|c| c == '*')
            || l.chars().all(|c| c == '_'))
}

fn list_item(line: &str) -> Option<(ListKind, &str)> {
    for bullet in ["- ", "* ", "+ "] {
        if let Some(rest) = line.strip_prefix(bullet) {
            return Some((ListKind::Bullet, rest));
        }
    }
    let digits = line.chars().take_while(|c| c.is_ascii_digit()).count();
    if (1..=9).contains(&digits) {
        let rest = &line[digits..];
        if let Some(rest) = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")) {
            return Some((ListKind::Number, rest));
        }
    }
    None
}

/// `| --- | :---: |`: a linha que separa o cabeçalho de uma tabela.
fn is_table_rule(line: &str) -> bool {
    let t = line.trim();
    t.contains('-') && t.contains('|') && t.chars().all(|c| matches!(c, '|' | '-' | ':' | ' '))
}

/// Células de uma linha `| a | b |`, respeitando `\|`.
fn table_cells(row: &str) -> Vec<String> {
    let inner = row.trim().trim_start_matches('|');
    let inner = inner
        .strip_suffix('|')
        .filter(|s| !s.ends_with('\\'))
        .unwrap_or(inner);
    let mut cells = vec![String::new()];
    let mut chars = inner.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'|') => {
                cells.last_mut().expect("uma célula").push('|');
                chars.next();
            }
            '|' => cells.push(String::new()),
            c => cells.last_mut().expect("uma célula").push(c),
        }
    }
    cells.into_iter().map(|c| c.trim().to_string()).collect()
}

/// Ênfase e afins dentro de um parágrafo. Um marcador só conta se houver o de
/// fechamento depois dele; sem par, fica como texto.
fn parse_inline(raw: &str) -> Vec<Span> {
    let chars: Vec<char> = raw.chars().collect();
    let mut spans: Vec<Span> = Vec::new();
    let mut marks: Vec<Mark> = Vec::new();
    let mut text = String::new();
    let mut i = 0;

    let has_ahead = |from: usize, token: &str| -> bool {
        let t: Vec<char> = token.chars().collect();
        (from..chars.len().saturating_sub(t.len() - 1)).any(|j| chars[j..j + t.len()] == t[..])
    };
    let push = |spans: &mut Vec<Span>, text: &mut String, marks: &[Mark]| {
        if !text.is_empty() {
            spans.push(Span {
                text: std::mem::take(text),
                marks: marks.to_vec(),
            });
        }
    };
    let toggle = |marks: &mut Vec<Mark>, mark: Mark| {
        if let Some(pos) = marks.iter().position(|m| *m == mark) {
            marks.remove(pos);
        } else {
            marks.push(mark);
        }
    };

    while i < chars.len() {
        let rest: String = chars[i..chars.len().min(i + 4)].iter().collect();
        let c = chars[i];
        if c == '\\' && i + 1 < chars.len() && "\\`*_~[]<>#!+-.()".contains(chars[i + 1]) {
            text.push(chars[i + 1]);
            i += 2;
            continue;
        }
        // [texto](endereço)
        if c == '[' {
            let close = (i + 1..chars.len()).find(|&j| chars[j] == ']');
            if let Some(close) = close.filter(|&j| chars.get(j + 1) == Some(&'(')) {
                if let Some(end) = (close + 2..chars.len()).find(|&j| chars[j] == ')') {
                    let href: String = chars[close + 2..end].iter().collect();
                    if nova_domain_text::is_link(&href) {
                        push(&mut spans, &mut text, &marks);
                        let label: String = chars[i + 1..close].iter().collect();
                        for mut s in parse_inline(&label) {
                            for m in &marks {
                                if !s.marks.iter().any(|x| x.kind() == m.kind()) {
                                    s.marks.push(m.clone());
                                }
                            }
                            s.marks.push(Mark::Link { href: href.clone() });
                            spans.push(s);
                        }
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        if c == '`' {
            if let Some(end) = (i + 1..chars.len()).find(|&j| chars[j] == '`') {
                push(&mut spans, &mut text, &marks);
                let code: String = chars[i + 1..end].iter().collect();
                let mut m = marks.clone();
                m.push(Mark::FontFamily {
                    value: "Consolas".into(),
                });
                spans.push(Span {
                    text: code,
                    marks: m,
                });
                i = end + 1;
                continue;
            }
        }
        // Regra do CommonMark: abre se o próximo caractere não é espaço; fecha
        // se o anterior não é espaço ("2 * 3 * 4" fica como está).
        let at = i;
        let opens = |len: usize| chars.get(at + len).is_some_and(|c| !c.is_whitespace());
        let closes = i > 0 && !chars[i - 1].is_whitespace();
        let mut consumed = false;
        for (token, mark) in [("**", Mark::Bold), ("__", Mark::Bold), ("~~", Mark::Strike)] {
            if rest.starts_with(token) {
                let on = marks.contains(&mark);
                if (on && closes) || (!on && opens(2) && has_ahead(i + 2, token)) {
                    push(&mut spans, &mut text, &marks);
                    toggle(&mut marks, mark);
                    i += 2;
                    consumed = true;
                    break;
                }
            }
        }
        if consumed {
            continue;
        }
        if rest.starts_with("<u>") || rest.starts_with("</u>") {
            push(&mut spans, &mut text, &marks);
            toggle(&mut marks, Mark::Underline);
            i += if rest.starts_with("<u>") { 3 } else { 4 };
            continue;
        }
        if (c == '*' || c == '_') && !rest.starts_with("**") && !rest.starts_with("__") {
            let on = marks.contains(&Mark::Italic);
            // "_" no meio de palavra (nome_de_arquivo) não é ênfase.
            let intraword = c == '_' && i > 0 && chars[i - 1].is_alphanumeric() && !on;
            if !intraword
                && ((on && closes) || (!on && opens(1) && has_ahead(i + 1, &c.to_string())))
            {
                push(&mut spans, &mut text, &marks);
                toggle(&mut marks, Mark::Italic);
                i += 1;
                continue;
            }
        }
        if c == '[' {
            // [texto](endereço) → texto
            let close = (i + 1..chars.len()).find(|&j| chars[j] == ']');
            if let Some(close) = close {
                if chars.get(close + 1) == Some(&'(') {
                    if let Some(end) = (close + 2..chars.len()).find(|&j| chars[j] == ')') {
                        text.extend(&chars[i + 1..close]);
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        text.push(c);
        i += 1;
    }
    push(&mut spans, &mut text, &marks);
    spans
}

#[cfg(test)]
mod tests {
    use super::*;
    use nova_domain_text::{Mark, TextCommand};

    #[test]
    fn links_vao_e_voltam() {
        let doc = import(
            1,
            "Veja [o **site**](https://exemplo.com) e [isto](javascript:x).",
        )
        .unwrap();
        let p = &doc.paragraphs()[0];
        let link = Mark::Link {
            href: "https://exemplo.com".into(),
        };
        assert!(p
            .spans
            .iter()
            .any(|s| s.text == "site" && s.marks.contains(&link) && s.marks.contains(&Mark::Bold)));
        assert!(
            p.text().ends_with("e isto."),
            "esquema não aceito: fica só o texto: {:?}",
            p.text()
        );
        assert!(export(&doc).contains("[o **site**](https://exemplo.com)"));
    }

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
    fn quebra_de_linha_manual_vira_quebra_forcada() {
        let mut doc = TextDocument::new(1);
        doc.execute(TextCommand::InsertText {
            block: 0,
            offset: 0,
            text: "Rua A, 10\u{b}São Paulo".into(),
            marks: None,
        })
        .unwrap();
        assert_eq!(export(&doc), "Rua A, 10\\\nSão Paulo");
    }

    #[test]
    fn abre_markdown() {
        let md = "# Título\n\nTexto com **negrito**, *itálico*, ~~fora~~ e <u>sub</u>.\nContinua [aqui](http://x) com `código`.  \nDepois da quebra.\n\n> citação\n\n- um\n  - dois\n- três\n\n1. a\n2. b\n\n```\nlet x = 1;\n```\n\nnome_de_arquivo e 2 * 3 * 4 e **sem fim";
        let p = parse(md);
        let texts: Vec<String> = p.iter().map(Paragraph::text).collect();
        assert_eq!(
            texts,
            [
                "Título",
                "Texto com negrito, itálico, fora e sub. Continua aqui com código.\u{b}Depois da quebra.",
                "citação",
                "um",
                "dois",
                "três",
                "a",
                "b",
                "let x = 1;",
                "nome_de_arquivo e 2 * 3 * 4 e **sem fim",
            ]
        );
        assert_eq!(p[0].style, BlockStyle::Heading1);
        let marks: Vec<Vec<MarkKind>> = p[1]
            .spans
            .iter()
            .map(|s| s.marks.iter().map(Mark::kind).collect())
            .collect();
        assert!(marks.contains(&vec![MarkKind::Bold]) && marks.contains(&vec![MarkKind::Italic]));
        assert!(
            marks.contains(&vec![MarkKind::Strike]) && marks.contains(&vec![MarkKind::Underline])
        );
        assert_eq!(p[2].style, BlockStyle::Quote);
        assert_eq!(
            (p[4].attrs.list, p[4].attrs.indent),
            (Some(ListKind::Bullet), 1)
        );
        assert_eq!(p[6].attrs.list, Some(ListKind::Number));
        assert_eq!(p[8].style, BlockStyle::Code);
    }

    #[test]
    fn exportar_e_abrir_de_novo() {
        use nova_domain_text::ParaAttr;
        let mut doc = TextDocument::from_plain_text(
            1,
            "Capítulo\num *dois* três\nitem\nsub\nlinha um\u{b}linha dois",
        );
        for c in [
            TextCommand::SetBlockStyle {
                block: 0,
                style: BlockStyle::Heading2,
            },
            TextCommand::ApplyMark {
                block: 1,
                offset: 3,
                len: 6,
                mark: Mark::Bold,
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
        ] {
            doc.execute(c).unwrap();
        }
        let back = import(2, &export(&doc)).unwrap();
        assert_eq!(back.paragraphs(), doc.paragraphs());
    }

    #[test]
    fn escapa_caracteres_do_markdown() {
        let doc = TextDocument::from_plain_text(1, "2*3 = 6 #fato");
        assert_eq!(export(&doc), r"2\*3 = 6 \#fato");
    }
}

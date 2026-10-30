//! Notas de rodapé nos formatos de texto (Markdown, HTML, texto puro): a chamada
//! (o caractere `FOOTNOTE_CHAR`) vira o número da nota, e as notas vão no fim.

use nova_domain_text::{Mark, TextDocument, FOOTNOTE_CHAR};

/// Número de cada chamada, na ordem em que os caracteres aparecem no documento,
/// e o texto de cada nota pela ordem do número.
pub struct Notes {
    pub calls: Vec<usize>,
    pub texts: Vec<String>,
}

pub fn collect(doc: &TextDocument) -> Notes {
    let order = doc.footnotes();
    let number = |id: &str| order.iter().position(|(i, _)| i == id).map(|p| p + 1);
    let mut calls = Vec::new();
    for p in doc.paragraphs() {
        for span in &p.spans {
            let id = span.marks.iter().find_map(|m| match m {
                Mark::Footnote { id } => Some(id.as_str()),
                _ => None,
            });
            for ch in span.text.chars() {
                if ch == FOOTNOTE_CHAR {
                    // Caractere sem marca (não deveria acontecer): some do texto.
                    calls.push(id.and_then(number).unwrap_or(0));
                }
            }
        }
    }
    Notes {
        calls,
        texts: order.into_iter().map(|(_, t)| t).collect(),
    }
}

/// Troca a k-ésima chamada no texto pelo que `call(n)` devolve (n = 0: chamada perdida).
pub fn replace_calls(text: &str, notes: &Notes, call: impl Fn(usize) -> String) -> String {
    let mut k = 0;
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch == FOOTNOTE_CHAR {
            let n = notes.calls.get(k).copied().unwrap_or(0);
            k += 1;
            if n > 0 {
                out.push_str(&call(n));
            }
        } else {
            out.push(ch);
        }
    }
    out
}

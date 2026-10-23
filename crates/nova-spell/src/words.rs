//! Divide texto corrido em palavras a verificar, com as regras do Word:
//! números, palavras com dígitos, URLs, e-mails, caminhos de arquivo e
//! palavras TODAS EM MAIÚSCULAS ficam de fora.

use crate::{APOSTROPHES, HYPHENS};

/// Uma palavra de `text` e sua posição em unidades UTF-16 (`start..end`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Word<'a> {
    pub text: &'a str,
    pub start: u32,
    pub end: u32,
}

/// As palavras de `text` que o corretor deve verificar, na ordem do texto.
///
/// Hífen e apóstrofo entre letras fazem parte da palavra ("guarda-chuva",
/// "d'água"); nas pontas, são pontuação (aspas simples, travessão).
pub fn words(text: &str) -> Vec<Word<'_>> {
    let mut out = Vec::new();
    let mut utf16 = 0u32;
    // Trecho entre espaços: (byte inicial, offset UTF-16 inicial).
    let mut chunk: Option<(usize, u32)> = None;
    for (i, c) in text.char_indices() {
        if c.is_whitespace() {
            if let Some((start, start16)) = chunk.take() {
                scan_chunk(&text[start..i], start16, &mut out);
            }
        } else if chunk.is_none() {
            chunk = Some((i, utf16));
        }
        utf16 += c.len_utf16() as u32;
    }
    if let Some((start, start16)) = chunk {
        scan_chunk(&text[start..], start16, &mut out);
    }
    out
}

/// Extrai as palavras de um trecho sem espaços, a menos que o trecho inteiro
/// seja um endereço (URL, e-mail, domínio, caminho).
fn scan_chunk<'a>(chunk: &'a str, start16: u32, out: &mut Vec<Word<'a>>) {
    if is_address(chunk) {
        return;
    }
    let chars: Vec<(usize, char)> = chunk.char_indices().collect();
    let mut utf16 = start16;
    // Palavra em andamento: (índice em `chars`, offset UTF-16).
    let mut current: Option<(usize, u32)> = None;
    for (k, &(_, c)) in chars.iter().enumerate() {
        let joins = is_joiner(c)
            && current.is_some()
            && chars
                .get(k + 1)
                .is_some_and(|&(_, next)| is_word_char(next));
        if is_word_char(c) || joins {
            if current.is_none() {
                current = Some((k, utf16));
            }
        } else if let Some((first, first16)) = current.take() {
            push_word(chunk, &chars, first, k, first16, utf16, out);
        }
        utf16 += c.len_utf16() as u32;
    }
    if let Some((first, first16)) = current {
        push_word(chunk, &chars, first, chars.len(), first16, utf16, out);
    }
}

fn push_word<'a>(
    chunk: &'a str,
    chars: &[(usize, char)],
    first: usize,
    end: usize,
    start16: u32,
    end16: u32,
    out: &mut Vec<Word<'a>>,
) {
    let from = chars[first].0;
    let to = chars.get(end).map_or(chunk.len(), |&(i, _)| i);
    let text = &chunk[from..to];
    if text.chars().any(char::is_numeric) || is_all_caps(text) {
        return;
    }
    out.push(Word {
        text,
        start: start16,
        end: end16,
    });
}

fn is_word_char(c: char) -> bool {
    // Acentos combinantes (U+0300–U+036F) fazem parte da letra anterior.
    c.is_alphanumeric() || ('\u{300}'..='\u{36f}').contains(&c)
}

fn is_joiner(c: char) -> bool {
    APOSTROPHES.contains(&c) || HYPHENS.contains(&c)
}

/// Siglas e palavras gritadas ("ONU", "NÃO"): pelo menos uma maiúscula e nenhuma minúscula.
fn is_all_caps(word: &str) -> bool {
    word.chars().any(char::is_uppercase) && !word.chars().any(char::is_lowercase)
}

fn is_address(chunk: &str) -> bool {
    let trimmed = chunk.trim_start_matches(|c: char| !c.is_alphanumeric());
    if chunk.contains("://") || chunk.contains('\\') || trimmed.to_lowercase().starts_with("www.") {
        return true;
    }
    // E-mail: algo@algo. Domínio ou nome de arquivo: letra.letra ("nova.org",
    // "relatorio.pdf"); também cobre abreviações como "e.g.".
    let chars: Vec<char> = chunk.chars().collect();
    chars
        .windows(3)
        .any(|w| is_word_char(w[0]) && (w[1] == '@' || w[1] == '.') && is_word_char(w[2]))
}

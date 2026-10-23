//! Desempenho: verificar 10 mil palavras deve levar menos de 100 ms, para o
//! editor poder revisar o documento a cada pausa na digitação.
//!
//! Fica num binário de teste à parte porque o cargo roda os binários um de
//! cada vez: a medição não disputa CPU com os testes que carregam dicionários.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use nova_spell::{words, Language, Speller};

const LIMIT: Duration = Duration::from_millis(100);

const PROSA: &str = "O corretor ortográfico da NovaOffice verifica cada parágrafo enquanto \
    você digita. Ele usa os mesmos dicionários do LibreOffice, então a exceção, o \
    guarda-chuva e a gota-d'água são reconhecidos, mas a excessão fica sublinhada. \
    Números como 2024, endereços como https://novaoffice.org e siglas como ABNT \
    não são marcados. ";

fn pt() -> &'static Speller {
    static PT: OnceLock<Speller> = OnceLock::new();
    PT.get_or_init(|| Speller::load(Language::PtBr).expect("dicionário embutido"))
}

/// Mede só a verificação: o dicionário já está carregado, como no editor.
fn time_misspelled(text: &str) -> (Duration, usize) {
    let speller = pt();
    let start = Instant::now();
    let found = speller.misspelled(text).len();
    (start.elapsed(), found)
}

#[test]
fn dez_mil_palavras_de_prosa() {
    let paragraphs = 10_000 / words(PROSA).len() + 1;
    let text = PROSA.repeat(paragraphs);
    assert!(words(&text).len() >= 10_000);
    let (elapsed, found) = time_misspelled(&text);
    // "NovaOffice" não está no dicionário; "excessão" está errada.
    assert_eq!(found, 2 * paragraphs);
    assert!(elapsed < LIMIT, "{elapsed:?} para 10 mil palavras");
}

#[test]
fn dez_mil_palavras_distintas() {
    // Pior caso para o cache de `misspelled`: nenhuma palavra se repete. Usa
    // radicais do próprio dicionário e estraga um a cada dez com "qz".
    let dic = include_str!("../dicionarios/pt_BR.dic");
    let stems: Vec<&str> = dic
        .lines()
        .skip(1)
        .map(|line| line.split('/').next().unwrap())
        .filter(|w| w.chars().all(char::is_lowercase))
        .collect();
    let mut text = String::new();
    for (i, stem) in stems
        .iter()
        .step_by(stems.len() / 10_000)
        .take(10_000)
        .enumerate()
    {
        text.push_str(stem);
        text.push_str(if i % 10 == 0 { "qz " } else { " " });
    }
    assert_eq!(words(&text).len(), 10_000);
    let (elapsed, found) = time_misspelled(&text);
    assert!((1_000..1_100).contains(&found), "{found} erradas");
    assert!(elapsed < LIMIT, "{elapsed:?} para 10 mil palavras");
}

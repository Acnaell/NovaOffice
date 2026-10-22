use super::*;
use std::sync::OnceLock;

/// Carregar um dicionário leva centenas de milissegundos; os testes compartilham um por idioma.
fn speller(language: Language) -> &'static Speller {
    static PT: OnceLock<Speller> = OnceLock::new();
    static EN: OnceLock<Speller> = OnceLock::new();
    static ES: OnceLock<Speller> = OnceLock::new();
    let cell = match language {
        Language::PtBr => &PT,
        Language::EnUs => &EN,
        Language::Es => &ES,
    };
    cell.get_or_init(|| Speller::load(language).expect("dicionário embutido"))
}

fn pt() -> &'static Speller {
    speller(Language::PtBr)
}

#[test]
fn etiquetas_de_idioma() {
    assert_eq!("pt-BR".parse::<Language>().unwrap(), Language::PtBr);
    assert_eq!("pt_br".parse::<Language>().unwrap(), Language::PtBr);
    assert_eq!("en".parse::<Language>().unwrap(), Language::EnUs);
    assert_eq!("es-MX".parse::<Language>().unwrap(), Language::Es);
    assert!(matches!(
        "de-DE".parse::<Language>(),
        Err(SpellError::UnknownLanguage(_))
    ));
    for language in Language::ALL {
        assert_eq!(language.tag().parse::<Language>().unwrap(), language);
    }
}

#[test]
fn carrega_os_tres_dicionarios() {
    assert!(speller(Language::EnUs).check("color"));
    assert!(!speller(Language::EnUs).check("colour"));
    assert!(speller(Language::Es).check("niño"));
    assert!(speller(Language::Es).check("corazón"));
    assert!(!speller(Language::Es).check("corazon"));
    assert_eq!(pt().language(), Language::PtBr);
}

#[test]
fn acentos() {
    for word in [
        "ação",
        "exceção",
        "você",
        "árvore",
        "pôr",
        "têm",
        "Brasil",
        "água",
    ] {
        assert!(pt().check(word), "{word} deveria estar correta");
    }
    // "arvore" e "analise" existem (verbos arvorar e analisar), por isso não entram aqui.
    for word in ["acao", "excecao", "voce", "tambem", "agua"] {
        assert!(!pt().check(word), "{word} deveria estar errada");
    }
}

#[test]
fn maiusculas_no_inicio_da_frase() {
    assert!(pt().check("Exceção"));
    assert!(pt().check("EXCEÇÃO"));
}

#[test]
fn hifen() {
    assert!(pt().check("guarda-chuva"));
    assert!(pt().check("guarda-chuvas"));
    assert!(pt().check("guarda\u{2010}chuva"), "hífen tipográfico");
    assert!(!pt().check("guarda-chuvaa"));
}

#[test]
fn apostrofo() {
    assert!(pt().check("d'água"));
    assert!(pt().check("d\u{2019}água"), "apóstrofo tipográfico");
    assert!(pt().check("gota-d'água"));
    assert!(speller(Language::EnUs).check("don't"));
    assert!(speller(Language::EnUs).check("don\u{2019}t"));
}

#[test]
fn sugere_excecao_para_excessao() {
    assert!(!pt().check("excessão"));
    let suggestions = pt().suggest("excessão");
    assert_eq!(
        suggestions.first().map(String::as_str),
        Some("exceção"),
        "{suggestions:?}"
    );
}

#[test]
fn sugestoes_comuns() {
    for (wrong, right) in [
        ("concerteza", "com certeza"),
        ("pesquiza", "pesquisa"),
        ("analize", "analise"),
    ] {
        let suggestions = pt().suggest(wrong);
        assert!(
            suggestions.iter().any(|s| s == right),
            "{wrong}: {suggestions:?}"
        );
    }
}

#[test]
fn no_maximo_oito_sugestoes() {
    for word in ["casa", "kasa", "xyzw", "excessão", "pobrema"] {
        let suggestions = pt().suggest(word);
        assert!(
            suggestions.len() <= MAX_SUGGESTIONS,
            "{word}: {suggestions:?}"
        );
        let mut unique = suggestions.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), suggestions.len());
    }
    assert!(pt().suggest("").is_empty());
}

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

/// Os trechos de `text` nos intervalos UTF-16 dados.
fn slices(text: &str, ranges: &[(u32, u32)]) -> Vec<String> {
    let units: Vec<u16> = text.encode_utf16().collect();
    ranges
        .iter()
        .map(|&(a, b)| String::from_utf16(&units[a as usize..b as usize]).unwrap())
        .collect()
}

fn texts(text: &str) -> Vec<&str> {
    words(text).into_iter().map(|w| w.text).collect()
}

#[test]
fn divide_em_palavras() {
    assert_eq!(
        texts("Olá, mundo! O guarda-chuva d'água — “ótimo”."),
        ["Olá", "mundo", "guarda-chuva", "d'água", "ótimo"]
    );
}

#[test]
fn hifen_e_apostrofo_nas_pontas_sao_pontuacao() {
    assert_eq!(
        texts("'aspas' -traço- ex- -ismo"),
        ["aspas", "traço", "ex", "ismo"]
    );
    assert_eq!(texts("guarda--chuva"), ["guarda", "chuva"]);
}

#[test]
fn ignora_numeros_e_palavras_com_digitos() {
    assert_eq!(
        texts("Em 2024 custava R$ 10,50 no 3º lote, código A1b2"),
        ["Em", "custava", "no", "lote", "código"]
    );
}

#[test]
fn ignora_urls_emails_e_caminhos() {
    let text = r"Veja https://exemplo.com/paginna, www.exemplo.com.br, fulano@exemplo.com e C:\Arquivos\documentu.";
    assert_eq!(texts(text), ["Veja", "e"]);
    assert_eq!(texts("(https://exemplo.com)."), Vec::<&str>::new());
}

#[test]
fn ignora_palavras_todas_em_maiusculas() {
    assert_eq!(
        texts("A ONU e a OTAN; NÃO ESCREVA ASSIM; Brasil"),
        ["e", "a", "Brasil"]
    );
}

#[test]
fn offsets_em_utf16() {
    // "😀" ocupa duas unidades UTF-16.
    let text = "😀 açaí excessão";
    let found = words(text);
    assert_eq!(
        found[0],
        Word {
            text: "açaí",
            start: 3,
            end: 7
        }
    );
    assert_eq!(
        found[1],
        Word {
            text: "excessão",
            start: 8,
            end: 16
        }
    );
}

#[test]
fn acento_combinante_faz_parte_da_palavra() {
    // "exceção" com "c" + cedilha combinante e "a" + til combinante.
    let text = "exc\u{0327}a\u{0303}o";
    assert_eq!(texts(text), [text]);
}

#[test]
fn misspelled_marca_so_as_erradas() {
    let text = "A excessão confirma a regra; o guarda-chuva ficou na ONU, veja www.siti.com.";
    let ranges = pt().misspelled(text);
    assert_eq!(slices(text, &ranges), ["excessão"]);
}

#[test]
fn misspelled_com_emoji_antes() {
    let text = "😀 Pobrema resolvido, pobrema!";
    let ranges = pt().misspelled(text);
    assert_eq!(ranges, [(3, 10), (22, 29)]);
    assert_eq!(slices(text, &ranges), ["Pobrema", "pobrema"]);
}

#[test]
fn misspelled_em_texto_vazio() {
    assert!(pt().misspelled("").is_empty());
    assert!(pt().misspelled("   \n\t ").is_empty());
}

//! Citações e bibliografia nos arquivos (ADR 0013).
//!
//! - .docx: as fontes em `customXml/item1.xml` (`b:Sources`, o formato de
//!   Gerenciar Fontes do Word); cada chamada é um campo `CITATION <tag> \p <página>`
//!   dentro de um `w:sdt` com `w:citation`, e a bibliografia é um campo
//!   `BIBLIOGRAPHY` num `w:sdt` da galeria "Bibliographies", como o Word grava.
//! - .odt: cada chamada é um `text:bibliography-mark` com os dados da fonte e a
//!   bibliografia é um `text:bibliography`, como o LibreOffice grava. O ODF não
//!   tem página por chamada: ela vai no texto da marca e é lida de volta dele.
//! - Texto, Markdown e HTML: a chamada vira o texto dela, "(SILVA, 2026)".

use std::collections::{BTreeMap, HashSet};

use nova_domain_text::{
    citation_text, is_note_id, Person, Source, SourceKind, TextDocument, CITATION_CHAR,
};
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::docx::esc;

/// Texto de cada chamada, na ordem do documento.
pub fn texts(doc: &TextDocument) -> Vec<String> {
    let sources = doc.sources();
    doc.citations()
        .iter()
        .map(|(id, page)| citation_text(sources.get(id), page.as_deref()))
        .collect()
}

/// Troca a k-ésima chamada no texto pelo texto dela (passado por `fmt`).
pub fn replace(text: &str, texts: &[String], fmt: impl Fn(&str) -> String) -> String {
    let mut k = 0;
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if ch == CITATION_CHAR {
            if let Some(t) = texts.get(k) {
                out.push_str(&fmt(t));
            }
            k += 1;
        } else {
            out.push(ch);
        }
    }
    out
}

/// Id do Nova a partir de uma marca de outro programa ("Sil26", "SILVA, 2026"):
/// só letras e dígitos ASCII, sem repetir os já usados.
pub(crate) fn id_from(tag: &str, taken: &mut HashSet<String>) -> String {
    let mut id: String = tag
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(28)
        .collect();
    if id.is_empty() {
        id = "src".into();
    }
    let base = id.clone();
    let mut n = 1;
    while !is_note_id(&id) || taken.contains(&id) {
        n += 1;
        id = format!("{base}{n}");
    }
    taken.insert(id.clone());
    id
}

// ---------------------------------------------------------------- .docx

const BIB_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";

fn word_type(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Book => "Book",
        SourceKind::Article => "JournalArticle",
        SourceKind::Web => "InternetSite",
        // O Word não tem "Tese": é um Relatório com Tipo de Tese e Instituição.
        SourceKind::Thesis => "Report",
    }
}

fn kind_of_word(value: &str) -> SourceKind {
    match value {
        "JournalArticle" | "ArticleInAPeriodical" => SourceKind::Article,
        "InternetSite" | "DocumentFromInternetSite" | "ElectronicSource" => SourceKind::Web,
        "Report" => SourceKind::Thesis,
        _ => SourceKind::Book,
    }
}

/// `customXml/item1.xml`: as fontes no formato `b:Sources` do Word.
pub(crate) fn docx_sources_xml(sources: &BTreeMap<String, Source>) -> String {
    let mut out = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><b:Sources SelectedStyle="" StyleName="ABNT" xmlns:b="{BIB_NS}" xmlns="{BIB_NS}">"#
    );
    for (id, s) in sources {
        out.push_str(&format!(
            "<b:Source><b:Tag>{}</b:Tag><b:SourceType>{}</b:SourceType>",
            esc(id),
            word_type(s.kind)
        ));
        match s.authors.as_slice() {
            [] => {}
            // Entidade (autor só com nome, sem prenome): b:Corporate.
            [p] if p.first.is_empty() => out.push_str(&format!(
                "<b:Author><b:Author><b:Corporate>{}</b:Corporate></b:Author></b:Author>",
                esc(&p.last)
            )),
            people => {
                out.push_str("<b:Author><b:Author><b:NameList>");
                for p in people {
                    out.push_str(&format!(
                        "<b:Person><b:Last>{}</b:Last>{}</b:Person>",
                        esc(&p.last),
                        if p.first.is_empty() {
                            String::new()
                        } else {
                            format!("<b:First>{}</b:First>", esc(&p.first))
                        }
                    ));
                }
                out.push_str("</b:NameList></b:Author></b:Author>");
            }
        }
        write_fields(&mut out, s);
        out.push_str("</b:Source>");
    }
    out.push_str("</b:Sources>");
    out
}

fn write_fields(out: &mut String, s: &Source) {
    let mut el = |name: &str, value: &str| {
        if !value.is_empty() {
            out.push_str(&format!("<b:{name}>{}</b:{name}>", esc(value)));
        }
    };
    el("Title", &s.title);
    el("Year", &s.year);
    el("City", &s.place);
    let publisher = if s.kind == SourceKind::Web {
        "InternetSiteTitle"
    } else {
        "Publisher"
    };
    el(publisher, &s.publisher);
    el("Edition", &s.edition);
    el("JournalName", &s.journal);
    el("Volume", &s.volume);
    el("Issue", &s.issue);
    el("Pages", &s.pages);
    el("Institution", &s.institution);
    el("ThesisType", &s.degree);
    el("URL", &s.url);
    if let [y, m, d] = s.accessed.splitn(3, '-').collect::<Vec<_>>()[..] {
        el("YearAccessed", y);
        el("MonthAccessed", m.trim_start_matches('0'));
        el("DayAccessed", d.trim_start_matches('0'));
    }
}

/// `itemProps1.xml` do customXml das fontes.
pub(crate) const DOCX_ITEM_PROPS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{6B0D2C4E-9A1F-4E7B-8C3D-5F2A1B0C9D8E}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>"#;

pub(crate) const DOCX_ITEM_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>"#;

/// Mês de acesso como o Word guarda (número ou nome, em português ou inglês).
fn month_number(value: &str) -> Option<u32> {
    if let Ok(n) = value.trim().parse::<u32>() {
        return (1..=12).contains(&n).then_some(n);
    }
    let v = value.trim().to_lowercase();
    const PT: [&str; 12] = [
        "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
    ];
    const EN: [&str; 12] = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    let prefix: String = v.chars().take(3).collect();
    PT.iter()
        .position(|m| *m == prefix)
        .or_else(|| EN.iter().position(|m| *m == prefix))
        .map(|i| i as u32 + 1)
}

/// Fontes de um `b:Sources` (customXml do Word ou do LibreOffice): (tag, fonte).
pub(crate) fn read_docx_sources(xml: &str) -> Vec<(String, Source)> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut out = Vec::new();
    let mut tag = String::new();
    let mut source = Source::default();
    let mut person = Person::default();
    let (mut ay, mut am, mut ad) = (String::new(), String::new(), String::new());
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                if name == "Source" {
                    tag.clear();
                    source = Source::default();
                    (ay, am, ad) = (String::new(), String::new(), String::new());
                }
                if name == "Person" {
                    person = Person::default();
                }
                stack.push(name);
            }
            Ok(Event::End(_)) => match stack.pop().as_deref() {
                Some("Person") if author_role(&stack) => {
                    if !person.last.is_empty() || !person.first.is_empty() {
                        source.authors.push(std::mem::take(&mut person));
                    }
                }
                Some("Source") => {
                    let (y, m, d) = (
                        ay.trim().parse::<u32>().ok(),
                        month_number(&am),
                        ad.trim().parse::<u32>().ok(),
                    );
                    if let (Some(y), Some(m), Some(d)) = (y, m, d) {
                        if (1000..=9999).contains(&y) && (1..=31).contains(&d) {
                            source.accessed = format!("{y:04}-{m:02}-{d:02}");
                        }
                    }
                    if !tag.is_empty() {
                        out.push((tag.clone(), std::mem::take(&mut source)));
                    }
                }
                _ => {}
            },
            Ok(Event::Text(t)) => {
                let Ok(text) = t.unescape() else { continue };
                let text = text.replace(['\r', '\n'], " ");
                let Some(last) = stack.last().map(String::as_str) else {
                    continue;
                };
                if !stack.iter().any(|s| s == "Source") {
                    continue;
                }
                let in_author = author_role(&stack[..stack.len() - 1])
                    || (stack.len() >= 2 && author_role(&stack[..stack.len() - 2]));
                match last {
                    "Last" if in_author => person.last.push_str(&text),
                    "First" | "Middle" if in_author => {
                        if !person.first.is_empty() {
                            person.first.push(' ');
                        }
                        person.first.push_str(&text);
                    }
                    "Corporate" if author_role(&stack[..stack.len() - 1]) => {
                        source.authors.push(Person {
                            last: text,
                            first: String::new(),
                        })
                    }
                    "Tag" => tag.push_str(&text),
                    "SourceType" => source.kind = kind_of_word(&text),
                    "Title" => source.title.push_str(&text),
                    "Year" => source.year.push_str(&text),
                    "City" => source.place.push_str(&text),
                    "Publisher" | "InternetSiteTitle" => source.publisher.push_str(&text),
                    "Edition" => source.edition.push_str(&text),
                    "JournalName" | "PeriodicalTitle" => source.journal.push_str(&text),
                    "Volume" => source.volume.push_str(&text),
                    "Issue" => source.issue.push_str(&text),
                    "Pages" => source.pages.push_str(&text),
                    "Institution" => source.institution.push_str(&text),
                    "ThesisType" => source.degree.push_str(&text),
                    "URL" => source.url.push_str(&text),
                    "YearAccessed" => ay.push_str(&text),
                    "MonthAccessed" => am.push_str(&text),
                    "DayAccessed" => ad.push_str(&text),
                    _ => {}
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

/// Dentro de `b:Author/b:Author` (os autores; editores e tradutores ficam de fora).
fn author_role(stack: &[String]) -> bool {
    let n = stack.len();
    n >= 2 && stack[n - 1] == "Author" && stack[n - 2] == "Author"
        || n >= 3
            && stack[n - 1] == "NameList"
            && stack[n - 2] == "Author"
            && stack[n - 3] == "Author"
}

/// Instrução do campo de citação: ` CITATION Sil26 \l 1046 \p 12 `.
pub(crate) fn docx_citation_instr(id: &str, page: Option<&str>) -> String {
    match page {
        Some(p) => format!(" CITATION {id} \\l 1046 \\p \"{}\" ", p.replace('"', "'")),
        None => format!(" CITATION {id} \\l 1046 "),
    }
}

/// (tag, página) de uma instrução `CITATION` (só a primeira fonte de `\m`).
pub(crate) fn parse_citation_instr(instr: &str) -> Option<(String, Option<String>)> {
    let tokens = tokenize(instr);
    let mut it = tokens.iter();
    if !it.next()?.eq_ignore_ascii_case("CITATION") {
        return None;
    }
    let tag = it.next()?.clone();
    let mut page = None;
    while let Some(t) = it.next() {
        if t.eq_ignore_ascii_case("\\p") {
            page = it.next().cloned().filter(|p| !p.trim().is_empty());
        }
    }
    Some((tag, page))
}

/// Palavras de uma instrução de campo; aspas juntam palavras com espaço.
fn tokenize(instr: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in instr.chars() {
        match ch {
            '"' => {
                if quoted {
                    out.push(std::mem::take(&mut cur));
                }
                quoted = !quoted;
            }
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

// ---------------------------------------------------------------- .odt

fn odf_type(kind: SourceKind) -> &'static str {
    match kind {
        SourceKind::Book => "book",
        SourceKind::Article => "article",
        SourceKind::Web => "www",
        SourceKind::Thesis => "phdthesis",
    }
}

/// Autores no campo `text:author` do LibreOffice: "Silva, João; Souza, Maria".
fn odf_authors(authors: &[Person]) -> String {
    authors
        .iter()
        .map(|p| {
            if p.first.is_empty() {
                p.last.clone()
            } else {
                format!("{}, {}", p.last, p.first)
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn parse_odf_authors(value: &str) -> Vec<Person> {
    value
        .split(';')
        .map(str::trim)
        .filter(|a| !a.is_empty())
        .map(|a| match a.split_once(',') {
            Some((last, first)) => Person {
                last: last.trim().into(),
                first: first.trim().into(),
            },
            None => Person {
                last: a.into(),
                first: String::new(),
            },
        })
        .collect()
}

/// `text:bibliography-mark` de uma chamada, com os dados da fonte e o texto da
/// chamada. O identificador é a chamada sem os parênteses ("SILVA, 2026, p. 12"):
/// o LibreOffice mostra o identificador entre o prefixo "(" e o sufixo ")" da
/// configuração da bibliografia (`ODT_BIB_CONFIG`).
pub(crate) fn odt_mark(source: Option<&Source>, text: &str) -> String {
    let identifier = text
        .trim()
        .strip_prefix('(')
        .and_then(|t| t.strip_suffix(')'))
        .unwrap_or(text);
    let mut out = format!(
        r#"<text:bibliography-mark text:identifier="{}""#,
        esc(identifier)
    );
    if let Some(s) = source {
        out.push_str(&format!(
            r#" text:bibliography-type="{}""#,
            odf_type(s.kind)
        ));
        let mut attr = |name: &str, value: &str| {
            if !value.is_empty() {
                out.push_str(&format!(r#" text:{name}="{}""#, esc(value)));
            }
        };
        attr("author", &odf_authors(&s.authors));
        attr("title", &s.title);
        attr("year", &s.year);
        attr("publisher", &s.publisher);
        attr("address", &s.place);
        attr("edition", &s.edition);
        attr("journal", &s.journal);
        attr("volume", &s.volume);
        attr("number", &s.issue);
        attr("pages", &s.pages);
        attr("school", &s.institution);
        attr("note", &s.degree);
        attr("url", &s.url);
        // O ODF não tem data de acesso: vai no primeiro campo livre.
        attr("custom1", &s.accessed);
    }
    out.push('>');
    out.push_str(&esc(text));
    out.push_str("</text:bibliography-mark>");
    out
}

/// Configuração da bibliografia no `office:styles`: chamadas entre parênteses,
/// sem numerar (autor-data).
pub(crate) const ODT_BIB_CONFIG: &str = r#"<text:bibliography-configuration text:prefix="(" text:suffix=")" text:numbered-entries="false" text:sort-by-position="false" fo:language="pt" fo:country="BR" text:sort-algorithm="alphanumeric"><text:sort-key text:key="author" text:sort-ascending="true"/><text:sort-key text:key="year" text:sort-ascending="true"/></text:bibliography-configuration>"#;

/// Fonte de um `text:bibliography-mark` (os atributos pelo nome local).
pub(crate) fn odt_read_mark(attrs: &[(String, String)]) -> Source {
    let get = |name: &str| {
        attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.replace(['\r', '\n'], " "))
            .unwrap_or_default()
    };
    let accessed = get("custom1");
    Source {
        kind: match get("bibliography-type").as_str() {
            "article" | "journal" => SourceKind::Article,
            "www" | "email" => SourceKind::Web,
            "phdthesis" | "mastersthesis" => SourceKind::Thesis,
            _ => SourceKind::Book,
        },
        authors: parse_odf_authors(&get("author")),
        title: get("title"),
        year: get("year"),
        publisher: get("publisher"),
        place: get("address"),
        edition: get("edition"),
        journal: get("journal"),
        volume: get("volume"),
        issue: get("number"),
        pages: get("pages"),
        institution: get("school"),
        degree: get("note"),
        url: get("url"),
        accessed: if accessed.len() == 10 {
            accessed
        } else {
            String::new()
        },
    }
}

/// Página citada a partir do texto da marca: "(SILVA, 2026, p. 12)" → "12".
pub(crate) fn page_from_text(text: &str) -> Option<String> {
    let inner = text.trim().strip_suffix(')')?;
    let (_, page) = inner.rsplit_once(", p. ")?;
    let page = page.trim();
    (!page.is_empty() && page.chars().count() <= 32).then(|| page.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instrucao_do_campo_vai_e_volta() {
        let i = docx_citation_instr("Sil26", Some("12-15"));
        assert_eq!(
            parse_citation_instr(&i),
            Some(("Sil26".into(), Some("12-15".into())))
        );
        assert_eq!(
            parse_citation_instr(" CITATION Sou20 \\l 1046 "),
            Some(("Sou20".into(), None))
        );
        assert_eq!(parse_citation_instr(" PAGE "), None);
    }

    #[test]
    fn ids_de_outros_programas() {
        let mut taken = HashSet::new();
        assert_eq!(id_from("Sil26", &mut taken), "Sil26");
        assert_eq!(id_from("Sil26", &mut taken), "Sil262");
        assert_eq!(id_from("SILVA, 2026", &mut taken), "SILVA2026");
        assert_eq!(id_from("—", &mut taken), "src");
    }

    #[test]
    fn pagina_no_texto_da_marca() {
        assert_eq!(
            page_from_text("(SILVA, 2026, p. 12)").as_deref(),
            Some("12")
        );
        assert_eq!(page_from_text("(SILVA, 2026)"), None);
    }

    #[test]
    fn autores_do_libreoffice() {
        let a = parse_odf_authors("Silva, João; Universidade de São Paulo");
        assert_eq!(a[0].last, "Silva");
        assert_eq!(a[0].first, "João");
        assert_eq!(a[1].last, "Universidade de São Paulo");
        assert_eq!(odf_authors(&a), "Silva, João; Universidade de São Paulo");
    }
}

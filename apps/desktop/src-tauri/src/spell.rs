//! Corretor ortográfico da janela: um `Speller` por idioma, carregado na
//! primeira vez que a interface pede, todos com o mesmo dicionário do usuário.

use std::collections::hash_map::{Entry, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use nova_spell::{Language, Speller, UserDictionary};

pub struct Spelling {
    /// Arquivo do dicionário do usuário; `None` mantém tudo só em memória.
    user_path: Option<PathBuf>,
    spellers: Mutex<HashMap<Language, Speller>>,
}

impl Spelling {
    pub fn new(user_path: Option<PathBuf>) -> Self {
        Spelling {
            user_path,
            spellers: Mutex::new(HashMap::new()),
        }
    }

    fn spellers(&self) -> MutexGuard<'_, HashMap<Language, Speller>> {
        self.spellers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// O corretor do idioma, carregando-o se preciso (algumas centenas de ms).
    fn speller<'a>(
        &self,
        spellers: &'a mut HashMap<Language, Speller>,
        language: &str,
    ) -> Result<&'a mut Speller, String> {
        let language: Language = language.parse().map_err(|e| format!("{e}"))?;
        Ok(match spellers.entry(language) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => entry.insert(
                Speller::load(language)
                    .map_err(|e| e.to_string())?
                    .with_user_dictionary(self.user_dictionary()),
            ),
        })
    }

    /// Lido do disco a cada idioma carregado, para incluir o que os outros
    /// idiomas já gravaram. Um arquivo ilegível não desliga o corretor.
    fn user_dictionary(&self) -> UserDictionary {
        let Some(path) = &self.user_path else {
            return UserDictionary::new();
        };
        UserDictionary::open(path).unwrap_or_else(|e| {
            eprintln!("dicionário do usuário ignorado ({}): {e}", path.display());
            UserDictionary::new()
        })
    }

    /// Para cada texto (um por parágrafo), os intervalos UTF-16 das palavras erradas.
    pub fn check(&self, language: &str, texts: &[String]) -> Result<Vec<Vec<(u32, u32)>>, String> {
        let mut spellers = self.spellers();
        let speller = self.speller(&mut spellers, language)?;
        Ok(texts.iter().map(|text| speller.misspelled(text)).collect())
    }

    pub fn suggest(&self, language: &str, word: &str) -> Result<Vec<String>, String> {
        let mut spellers = self.spellers();
        Ok(self.speller(&mut spellers, language)?.suggest(word))
    }

    /// "Adicionar ao dicionário": vale para todos os idiomas, como no LibreOffice.
    pub fn add_word(&self, language: &str, word: &str) -> Result<(), String> {
        self.for_all(language, |speller| speller.add_word(word))
    }

    pub fn ignore_all(&self, language: &str, word: &str) -> Result<(), String> {
        self.for_all(language, |speller| speller.ignore_all(word))
    }

    /// Aplica a mudança a todos os idiomas carregados, para eles continuarem
    /// com o mesmo dicionário do usuário (e gravarem o mesmo arquivo).
    fn for_all(
        &self,
        language: &str,
        change: impl Fn(&mut Speller) -> Result<(), nova_spell::SpellError>,
    ) -> Result<(), String> {
        let mut spellers = self.spellers();
        self.speller(&mut spellers, language)?;
        for speller in spellers.values_mut() {
            change(speller).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_file(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("nova-desktop-spell-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("dicionario.json")
    }

    #[test]
    fn verifica_cada_paragrafo() {
        let spelling = Spelling::new(None);
        let texts = [
            "A excessão confirma a regra".to_owned(),
            String::new(),
            "Tudo certo".to_owned(),
        ];
        assert_eq!(
            spelling.check("pt-BR", &texts).unwrap(),
            [vec![(2, 10)], vec![], vec![]]
        );
        assert_eq!(spelling.suggest("pt-BR", "excessão").unwrap()[0], "exceção");
        assert!(spelling.check("xx", &texts).is_err());
    }

    #[test]
    fn dicionario_do_usuario_vale_para_todos_os_idiomas() {
        let path = temp_file("todos");
        let spelling = Spelling::new(Some(path.clone()));
        let text = ["NovaOffice Acnaell".to_owned()];
        assert_eq!(
            spelling.check("en-US", &text).unwrap(),
            [vec![(0, 10), (11, 18)]]
        );

        spelling.add_word("pt-BR", "NovaOffice").unwrap();
        spelling.ignore_all("pt-BR", "Acnaell").unwrap();
        assert_eq!(spelling.check("en-US", &text).unwrap(), [vec![]]);
        assert_eq!(spelling.check("pt-BR", &text).unwrap(), [vec![]]);
        // Um idioma carregado depois lê o que já foi gravado.
        assert_eq!(spelling.check("es", &text).unwrap(), [vec![]]);

        let reopened = Spelling::new(Some(path.clone()));
        assert_eq!(reopened.check("pt-BR", &text).unwrap(), [vec![]]);
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn arquivo_ilegivel_nao_desliga_o_corretor() {
        let path = temp_file("ilegivel");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ não é json").unwrap();
        let spelling = Spelling::new(Some(path.clone()));
        assert_eq!(
            spelling.check("pt-BR", &["excessão".to_owned()]).unwrap(),
            [vec![(0, 8)]]
        );
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}

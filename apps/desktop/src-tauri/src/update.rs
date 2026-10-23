//! Aviso de atualização: consulta a última release no GitHub, compara com a
//! versão do app e, no Windows, baixa o instalador, confere o SHA-256 com o
//! `.sha256` publicado junto e o roda em modo passivo.
//!
//! A análise da resposta e a comparação de versões não usam a rede: a ponte
//! de testes (e2e/bridge) chama `evaluate` com uma resposta simulada.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Última release publicada (o GitHub não lista rascunhos nem pré-lançamentos aqui).
pub const LATEST_URL: &str = "https://api.github.com/repos/Acnaell/NovaOffice/releases/latest";

/// Só baixa arquivos das releases do próprio repositório.
const DOWNLOAD_PREFIX: &str = "https://github.com/Acnaell/NovaOffice/releases/download/";

/// Versão do app, a mesma do workspace e do tauri.conf.json.
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

/// Uma versão mais nova que a do app, como a interface mostra.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// Sem o "v" da tag: "0.1.7".
    pub version: String,
    /// Notas da release, em Markdown.
    pub notes: String,
    /// Página da release, para o navegador (macOS, Linux ou sem instalador).
    pub page_url: String,
    pub installer: Option<Installer>,
    /// Baixar e instalar pelo app: só no Windows, com instalador e checksum publicados.
    pub can_install: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installer {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub checksum_url: String,
}

/// Progresso do download, enviado à interface no evento `update-progress`.
#[derive(Serialize, Clone, Copy, Debug)]
pub struct Progress {
    pub received: u64,
    pub total: u64,
}

/// Lê uma versão com ou sem o "v" da tag.
pub fn parse_version(text: &str) -> Option<Version> {
    Version::parse(text.trim().trim_start_matches(['v', 'V'])).ok()
}

/// `candidate` é uma versão estável mais nova que `current`. Pré-lançamentos
/// (0.2.0-beta.1) nunca são oferecidos.
pub fn is_newer(current: &str, candidate: &str) -> bool {
    match (parse_version(current), parse_version(candidate)) {
        (Some(current), Some(candidate)) => candidate.pre.is_empty() && candidate > current,
        _ => false,
    }
}

/// Nome do instalador do Windows que a release publica (bundle NSIS do Tauri).
pub fn installer_name(version: &str) -> String {
    format!("NovaOffice_{version}_x64-setup.exe")
}

/// Analisa a resposta de `releases/latest`. `None` se não houver versão nova
/// (ou se for rascunho ou pré-lançamento).
pub fn evaluate(json: &str, current: &str, windows: bool) -> Result<Option<UpdateInfo>, String> {
    let release: GitHubRelease =
        serde_json::from_str(json).map_err(|e| format!("resposta inválida do GitHub: {e}"))?;
    if release.draft || release.prerelease || !is_newer(current, &release.tag_name) {
        return Ok(None);
    }
    let version = parse_version(&release.tag_name)
        .ok_or("versão inválida")?
        .to_string();
    let asset = |name: &str| release.assets.iter().find(|a| a.name == name);
    let wanted = installer_name(&version);
    let installer = asset(&wanted).and_then(|exe| {
        let sum = asset(&format!("{wanted}.sha256"))?;
        Some(Installer {
            name: exe.name.clone(),
            url: exe.browser_download_url.clone(),
            size: exe.size,
            checksum_url: sum.browser_download_url.clone(),
        })
    });
    Ok(Some(UpdateInfo {
        can_install: windows && installer.is_some(),
        version,
        notes: release.body.unwrap_or_default(),
        page_url: release.html_url,
        installer,
    }))
}

/// O hash de um arquivo `.sha256` (formato do sha256sum: "hash  nome").
pub fn parse_checksum(text: &str) -> Option<String> {
    let hash = text.split_whitespace().next()?.to_ascii_lowercase();
    (hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then_some(hash)
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .user_agent(&format!("NovaOffice/{CURRENT}"))
        .build()
}

/// Consulta o GitHub. Sem conexão é erro; sem versão nova, `None`.
pub fn check() -> Result<Option<UpdateInfo>, String> {
    let json = agent()
        .get(LATEST_URL)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("consultando atualizações: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    evaluate(&json, CURRENT, cfg!(windows))
}

/// Baixa o instalador para `dir`, conferindo o SHA-256. Um arquivo que não
/// confere é apagado.
pub fn download(
    installer: &Installer,
    dir: &Path,
    mut progress: impl FnMut(Progress),
) -> Result<PathBuf, String> {
    for url in [&installer.url, &installer.checksum_url] {
        if !url.starts_with(DOWNLOAD_PREFIX) {
            return Err(format!("endereço de download inesperado: {url}"));
        }
    }
    let agent = agent();
    let expected = agent
        .get(&installer.checksum_url)
        .call()
        .map_err(|e| format!("baixando o checksum: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    let expected = parse_checksum(&expected).ok_or("arquivo .sha256 inválido")?;

    let response = agent
        .get(&installer.url)
        .call()
        .map_err(|e| format!("baixando o instalador: {e}"))?;
    let total = response
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(installer.size);
    let path = dir.join(&installer.name);
    let mut file = File::create(&path).map_err(|e| format!("criando {}: {e}", path.display()))?;
    let mut reader = response.into_reader();
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 64 * 1024];
    let (mut received, mut reported) = (0u64, 0u64);
    progress(Progress { received, total });
    loop {
        let n = reader
            .read(&mut buffer)
            .map_err(|e| format!("baixando o instalador: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        received += n as u64;
        // Um aviso a cada 1% basta para a barra.
        if received - reported >= total.max(100) / 100 {
            reported = received;
            progress(Progress { received, total });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    progress(Progress {
        received,
        total: total.max(received),
    });
    let actual = hex(&hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&path);
        return Err(format!(
            "o instalador baixado não confere (SHA-256 {actual}, esperado {expected})"
        ));
    }
    Ok(path)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Roda o instalador em modo passivo (só a barra de progresso, sem perguntas).
pub fn launch_installer(path: &Path) -> Result<(), String> {
    std::process::Command::new(path)
        .arg("/P")
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("abrindo o instalador: {e}"))
}

/// O que a janela lembra entre consultar, baixar e instalar: a interface só
/// pede "baixe a versão encontrada", nunca passa endereços.
#[derive(Default)]
pub struct Updates {
    pub found: Mutex<Option<UpdateInfo>>,
    pub downloaded: Mutex<Option<PathBuf>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r###"{
        "url": "https://api.github.com/repos/Acnaell/NovaOffice/releases/1",
        "html_url": "https://github.com/Acnaell/NovaOffice/releases/tag/v0.2.0",
        "tag_name": "v0.2.0",
        "name": "NovaOffice 0.2.0",
        "draft": false,
        "prerelease": false,
        "body": "## Novidades\n\n- Aba **Exibir**",
        "assets": [
            {"name": "NovaOffice_0.2.0_x64-setup.exe", "size": 4200000,
             "browser_download_url": "https://github.com/Acnaell/NovaOffice/releases/download/v0.2.0/NovaOffice_0.2.0_x64-setup.exe"},
            {"name": "NovaOffice_0.2.0_x64-setup.exe.sha256", "size": 97,
             "browser_download_url": "https://github.com/Acnaell/NovaOffice/releases/download/v0.2.0/NovaOffice_0.2.0_x64-setup.exe.sha256"},
            {"name": "NovaOffice_0.2.0_aarch64.dmg", "size": 9000000,
             "browser_download_url": "https://github.com/Acnaell/NovaOffice/releases/download/v0.2.0/NovaOffice_0.2.0_aarch64.dmg"}
        ]
    }"###;

    #[test]
    fn compara_versoes_semver() {
        assert!(is_newer("0.1.6", "v0.1.7"));
        assert!(is_newer("0.1.6", "0.2.0"));
        assert!(is_newer("0.1.9", "0.1.10"), "número, não texto");
        assert!(is_newer("1.0.0-beta.2", "1.0.0"));
        assert!(!is_newer("0.1.6", "v0.1.6"));
        assert!(!is_newer("0.1.7", "0.1.6"));
        assert!(!is_newer("0.1.6", "v0.2.0-beta.1"), "pré-lançamento");
        assert!(!is_newer("0.1.6", "nightly"));
        assert!(!is_newer("0.1", "0.2.0"));
    }

    #[test]
    fn le_a_release_do_github() {
        let info = evaluate(SAMPLE, "0.1.6", true).unwrap().unwrap();
        assert_eq!(info.version, "0.2.0");
        assert!(info.notes.contains("Aba **Exibir**"));
        assert_eq!(
            info.page_url,
            "https://github.com/Acnaell/NovaOffice/releases/tag/v0.2.0"
        );
        let installer = info.installer.as_ref().unwrap();
        assert_eq!(installer.name, "NovaOffice_0.2.0_x64-setup.exe");
        assert_eq!(installer.size, 4_200_000);
        assert!(installer.checksum_url.ends_with(".exe.sha256"));
        assert!(info.can_install);

        // macOS e Linux: abre a página da release.
        assert!(
            !evaluate(SAMPLE, "0.1.6", false)
                .unwrap()
                .unwrap()
                .can_install
        );
        // Já atualizado.
        assert_eq!(evaluate(SAMPLE, "0.2.0", true).unwrap(), None);
    }

    #[test]
    fn ignora_pre_lancamentos_e_rascunhos() {
        let pre = SAMPLE.replace(r#""prerelease": false"#, r#""prerelease": true"#);
        assert_eq!(evaluate(&pre, "0.1.6", true).unwrap(), None);
        let draft = SAMPLE.replace(r#""draft": false"#, r#""draft": true"#);
        assert_eq!(evaluate(&draft, "0.1.6", true).unwrap(), None);
        let beta = SAMPLE.replace("\"v0.2.0\"", "\"v0.2.0-rc.1\"");
        assert_eq!(evaluate(&beta, "0.1.6", true).unwrap(), None);
    }

    #[test]
    fn sem_checksum_nao_instala_pelo_app() {
        let json = SAMPLE.replace(".exe.sha256\"", ".exe.sig\"");
        let info = evaluate(&json, "0.1.6", true).unwrap().unwrap();
        assert_eq!(info.installer, None);
        assert!(!info.can_install);
    }

    #[test]
    fn resposta_invalida_e_erro() {
        assert!(evaluate("{\"message\": \"API rate limit exceeded\"}", "0.1.6", true).is_err());
        assert!(evaluate("<html>", "0.1.6", true).is_err());
    }

    #[test]
    fn le_o_arquivo_sha256() {
        let hash = "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08";
        assert_eq!(
            parse_checksum(&format!("{hash}  NovaOffice_0.2.0_x64-setup.exe\n")),
            Some(hash.to_ascii_lowercase())
        );
        assert_eq!(parse_checksum(hash), Some(hash.to_ascii_lowercase()));
        assert_eq!(parse_checksum("abc  arquivo"), None);
        assert_eq!(parse_checksum(""), None);
    }

    #[test]
    fn hash_em_hexadecimal() {
        assert_eq!(
            hex(&Sha256::digest(b"test")),
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
        );
    }

    #[test]
    fn recusa_download_de_outro_endereco() {
        let installer = Installer {
            name: "x.exe".into(),
            url: "https://example.com/x.exe".into(),
            size: 1,
            checksum_url: "https://example.com/x.exe.sha256".into(),
        };
        let err = download(&installer, &std::env::temp_dir(), |_| {}).unwrap_err();
        assert!(err.contains("inesperado"));
    }

    /// Contra o GitHub de verdade: `cargo test -p nova-desktop -- --ignored rede`.
    #[test]
    #[ignore = "usa a rede"]
    fn rede_baixa_e_confere_a_release_atual() {
        let json = agent()
            .get(LATEST_URL)
            .call()
            .unwrap()
            .into_string()
            .unwrap();
        let info = evaluate(&json, "0.0.1", true).unwrap().unwrap();
        let installer = info.installer.expect("instalador do Windows na release");
        let dir = std::env::temp_dir().join(format!("nova-update-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut last = None;
        let path = download(&installer, &dir, |p| last = Some(p)).unwrap();
        let last = last.unwrap();
        assert_eq!(last.received, last.total);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), installer.size);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

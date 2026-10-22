# Como lançar uma versão

As versões são publicadas pelo workflow `.github/workflows/release.yml` quando uma tag `vX.Y.Z`
chega ao GitHub. Ele cria a release como rascunho, compila o app desktop e o CLI `nova` para
Windows, macOS e Linux, envia os instaladores com somas SHA-256 e só publica quando tudo deu certo.
O texto da release vem da seção da versão no `CHANGELOG.md`.

## Passo a passo

1. **Atualize a versão nos três lugares** (todas iguais, por exemplo `0.2.0`):
   - `Cargo.toml` → `[workspace.package] version`
   - `apps/desktop/src-tauri/tauri.conf.json` → `version`
   - `apps/desktop/package.json` → `version` (depois rode `npm install` em `apps/desktop` para
     atualizar o `package-lock.json`)
2. **Atualize o `Cargo.lock`**: `cargo check` já faz isso.
3. **Escreva o changelog**: no `CHANGELOG.md`, renomeie `## [Não lançado]` para
   `## [0.2.0] - AAAA-MM-DD`, crie uma nova seção `## [Não lançado]` vazia acima dela
   e atualize os links no fim do arquivo.
4. **Confira localmente**:
   ```powershell
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   cd apps/desktop; npm test; cd ../..
   ```
5. **Faça o commit e crie a tag**:
   ```powershell
   git add -A
   git commit -m "Versão 0.2.0"
   git push
   git tag v0.2.0
   git push origin v0.2.0
   ```
   Sem Git na linha de comando: depois do commit, abra **Actions → Release → Run workflow** no
   GitHub e informe a versão (`v0.2.0`); o workflow cria a tag sozinho.
6. Acompanhe em **Actions → Release**. Em 15 a 25 minutos a versão aparece em **Releases**.

## Regras

- A tag precisa ser igual às três versões com `v` na frente; se não for, o workflow para no
  primeiro passo sem publicar nada.
- Tags com sufixo (`v0.2.0-beta.1`) são publicadas como **pré-lançamento** e não substituem a versão
  "latest" usada pelos scripts de instalação.
- Se algum build falhar, a release fica como **rascunho** (só você vê). Corrija e rode
  **Actions → Release → Run workflow** informando a tag; os arquivos são substituídos.

## Arquivos publicados

| Arquivo | Conteúdo |
| --- | --- |
| `NovaOffice_<versão>_x64-setup.exe`, `NovaOffice_<versão>_x64_en-US.msi` | App desktop para Windows 10/11 |
| `NovaOffice_<versão>_aarch64.dmg`, `NovaOffice_<versão>_x64.dmg` | App desktop para macOS (Apple Silicon e Intel) |
| `NovaOffice_<versão>_amd64.AppImage`, `.deb`, `.rpm` | App desktop para Linux x86_64 |
| `nova-<alvo>.zip` / `nova-<alvo>.tar.gz` | CLI para Windows, macOS e Linux (x86_64 e ARM64) |
| `*.sha256`, `SHA256SUMS.txt` | Somas de verificação |

Os pacotes do CLI não incluem a versão no nome, então
`https://github.com/Acnaell/novaoffice/releases/latest/download/<arquivo>` sempre aponta para a
versão mais recente (é o que os scripts `scripts/install.*` usam).

## Assinatura de código (futuro)

Os instaladores ainda não são assinados. No Windows o SmartScreen mostra um aviso na primeira
execução; no macOS o app tem só assinatura ad-hoc, então na primeira vez é preciso abrir com o botão
direito → **Abrir**. Para remover esses avisos: certificado Authenticode no Windows e conta Apple
Developer para assinar e notarizar no macOS, configurados como segredos do repositório.

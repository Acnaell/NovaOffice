# Nova Drive: visão do produto

> Status: ideia em discussão, com um teste do motor já feito (veja "Teste do Rclone").

## Em uma frase

Um conector local para o drive que a pessoa já usa (Google Drive, OneDrive, Dropbox, Box, pCloud,
Mega, iCloud, Nextcloud, S3 e outros). Os arquivos aparecem no computador e na NovaOffice sem a
NovaOffice ter servidor próprio. A suíte continua gratuita: o espaço é o do plano de nuvem que a
pessoa já tem.

## O que faz

1. **Navegador de arquivos** dentro do app: todas as contas lado a lado, com abrir, baixar, enviar,
   mover, renomear e excluir. Mostra o espaço usado de cada conta.
2. **Pastas sincronizadas**: a pessoa escolhe pastas que ficam no computador e sincronizam nos dois
   sentidos, para trabalhar sem internet.
3. **Unidade no sistema**: o drive aparece como uma letra no Windows (por exemplo, `G:`) ou como
   pasta no macOS e no Linux, com cache local.
4. **Integração com a suíte**:
   - Arquivo → Abrir e Salvar do Nova Text mostram o Nova Drive.
   - Anexos do Nova Mail podem ir direto para o drive.

## Motor: Rclone

O [Rclone](https://rclone.org) é o motor. A licença é MIT, a mesma da NovaOffice, e ele conecta mais
de 70 serviços. O app desktop leva o executável junto (sidecar do Tauri) e o controla pela API de
controle remoto (`rclone rcd`). A pessoa nunca vê linha de comando.

Outras opções que foram avaliadas:

| Ferramenta | Por que não é a base |
| --- | --- |
| FreeFileSync (GPL-3.0) | Programa fechado em si, sem API para outro app controlar; poucos serviços de nuvem |
| Syncthing (MPL-2.0) | Sincroniza entre aparelhos da pessoa, sem servidor; não conecta Google Drive nem OneDrive |
| Nextcloud (GPL/AGPL) | Exige servidor próprio; quem usa Nextcloud entra como mais um serviço, pelo Rclone (WebDAV) |

## Teste do Rclone (23/10/2026)

Rclone v1.75.2, controlado só pela API, com uma "nuvem" simulada: um servidor WebDAV no modo
ownCloud, com data de modificação e hashes MD5/SHA-1, como um drive de verdade. O script é
[`scripts/experimentos/rclone_api.py`](../../scripts/experimentos/rclone_api.py) e pode ser rodado
de novo.

| O que o Nova Drive precisa | Chamada da API | Resultado |
| --- | --- | --- |
| Adicionar conta sem perguntas no terminal | `config/create` com `nonInteractive` | ✅ A senha fica ofuscada no arquivo de configuração, nunca em texto puro |
| Listar pastas e arquivos | `operations/list` | ✅ Nome, tamanho, tipo (MIME) e data |
| Baixar em segundo plano com barra de progresso | `operations/copyfile` com `_async` + `core/stats` | ✅ 60 MB com bytes, velocidade e % por arquivo; conteúdo idêntico |
| Cancelar no meio | `job/stop` | ✅ Para na hora e apaga o arquivo parcial |
| Enviar arquivo | `operations/copyfile` | ✅ |
| Pasta sincronizada | `sync/bisync` (primeira vez com `resync`) | ✅ Mudanças dos dois lados chegam ao outro, e o que foi apagado na nuvem some no PC |
| Conflito (mesmo arquivo editado nos dois lados) | `sync/bisync` | ✅ Nada se perde: ficam as duas versões, renomeadas (`.conflict1`/`.conflict2`). O nome e a regra (manter a mais nova, por exemplo) são configuráveis |
| Proteção contra apagar demais | `sync/bisync` | ✅ Se a sincronização fosse apagar muitos arquivos de uma vez, ela para e pede confirmação. A interface deve mostrar isso como pergunta |
| Unidade no sistema | `mount/mount` com cache `full` | ✅ No Linux (FUSE): arquivos visíveis no sistema, e um arquivo salvo pela unidade chega à nuvem. No Windows precisa do WinFsp |
| Assistente de conta do Google Drive | `config/create` em passos | ✅ É controlável pela API, pergunta por pergunta. ⚠️ A primeira pergunta avisa que a chave compartilhada do Rclone para o Google Drive está sendo desativada em 2026 |

### O que o teste mostrou

- **A API cobre tudo o que a interface precisa**: contas, navegação, transferências com progresso
  e cancelamento, sincronização nos dois sentidos, conflitos e montagem. Não é preciso mexer no
  código do Rclone.
- **Mudanças feitas direto na nuvem aparecem com atraso**, por causa do cache de pastas. Google
  Drive, OneDrive e Dropbox avisam mudanças (o Rclone consulta a cada minuto, mais ou menos). Para
  os outros serviços, o Nova Drive atualiza ao abrir a pasta.
- **A sincronização não é contínua** no Rclone: cada `bisync` é uma rodada. O Nova Drive agenda as
  rodadas: a cada poucos minutos, ao salvar um arquivo na pasta e quando o computador volta a ter
  internet.

## Google Drive e OneDrive: o que precisa de cadastro

- **Google Drive:** como a chave compartilhada do Rclone deixa de funcionar em 2026, a NovaOffice
  precisa da própria chave (projeto no Google Cloud). O acesso ao Drive inteiro é um escopo
  restrito. Acima de 100 usuários, o Google exige verificação, com avaliação de segurança, que pode
  ter custo. As saídas são:
  - escopo `drive.file`: só os arquivos que o próprio app criou ou abriu, sem avaliação;
  - deixar cada pessoa usar a própria chave do Google, com um passo a passo dentro do app.
- **OneDrive:** registrar o app no Microsoft Entra. Não tem avaliação paga.
- **Dropbox, Box, pCloud:** cadastro de app em cada um. Dropbox exige revisão para mais de 500
  usuários.
- **Serviços com usuário e senha** (WebDAV, Nextcloud, S3, Mega, FTP/SFTP): funcionam sem cadastro.

## Arquitetura proposta

```
apps/desktop/src-tauri
  drive.rs          inicia o rclone rcd (sidecar) com usuário e senha aleatórios a cada abertura,
                    só em 127.0.0.1; repassa chamadas; encerra junto com o app
crates/nova-drive   cliente da API (tipos das respostas, jobs, progresso), regras de agendamento
                    das pastas sincronizadas, mapeamento de erros para mensagens em português
apps/desktop/src    navegador de arquivos, assistente de contas, painel de transferências
```

- A configuração do Rclone fica na pasta de dados da NovaOffice. Ela pode ser criptografada com
  uma senha guardada no cofre do sistema (Windows Credential Manager, Keychain), já que tem os
  tokens das contas.
- O Rclone é baixado e conferido (SHA-256) no build da release, para cada sistema. Ele não entra no
  repositório.

## Identidade visual

Forma escolhida: **arcos**, uma nuvem geométrica feita de um quarto de círculo e um semicírculo sobre
uma base reta, com cantos vivos. É da mesma família do quarto de círculo do Nova Base e diferente
das bolhas sobrepostas do OneDrive. Com o Nova Mail, a grade do símbolo vira 4 × 2. Cor ainda em
aberto; proposta: índigo `#9AA5F5`.

## Roteiro

1. Sidecar do Rclone no app e no build da release (Windows, macOS, Linux), com o motor protegido
   por senha aleatória.
2. Contas com usuário e senha (WebDAV/Nextcloud, S3, SFTP) e navegador de arquivos.
3. OAuth: OneDrive (cadastro na Microsoft) e Google Drive (chave própria; decidir entre `drive.file`
   e verificação).
4. Transferências com progresso e cancelamento; Abrir e Salvar do Nova Text no drive.
5. Pastas sincronizadas (bisync agendado, conflitos e confirmação de exclusões).
6. Unidade no sistema (WinFsp no Windows, macFUSE ou FUSE-T no macOS, FUSE no Linux).
